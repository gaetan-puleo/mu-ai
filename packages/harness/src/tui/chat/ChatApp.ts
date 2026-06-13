import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import type { AgentSession, AgentSessionEvent, SessionRecord } from '../../session';
import type { ApprovalAction, ApprovalManager, PendingApproval } from '../../permissions';
import type { SubAgentRegistry, SubAgentResult, SubAgentRun } from '../../subAgents';
import { audio, type ContentPart, image, type Message } from 'mu-core';
import {
  box,
  column,
  type Component,
  flex,
  type InputEvent,
  measure,
  ProcessTerminal,
  readClipboardImage,
  type ScrollView,
  scrollView,
  truncateToWidth,
  TUI,
  visibleWidth,
} from 'mu-tui';
import { buildCommands, type ChatCommand, type CommandHost, filterCommands } from './commands';
import { MultilineEditor } from './editor';
import { activeMention, type Candidate, collectCandidates, mentionRanges, rank } from './picker';
import { formatTokens, statusComponent, statusFromEvent, type StatusState } from './status';
import { asHexColor, fgToAnsi, styleToAnsi, type Theme, ThemeProvider, themesByName } from './theme';
import {
  entryComponent,
  formatToolArgs,
  stickyHeader,
  type SubAgentEntry,
  type SubAgentHandle,
  Transcript,
  transcriptComponent,
} from './transcript';

const RESET = '\x1b[0m';
const PROMPT_WIDTH = 2;

const encodeBinary = (_key: string, value: unknown) =>
  value instanceof Uint8Array ? { __binary: 'base64', data: Buffer.from(value).toString('base64') } : value;

const textOf = (message: Message): string =>
  message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
const SPINNER_INTERVAL_MS = 100;
const MAX_LIST_ROWS = 8;
const SPLASH_INPUT_WIDTH = 72;

const APPROVAL_OPTIONS: { label: string; value: ApprovalAction }[] = [
  { label: 'Approve once', value: 'approve' },
  { label: 'Approve for this session', value: 'approve_always' },
  { label: 'Deny', value: 'deny' },
];

export interface ModelInfo {
  id: string;
  ownedBy?: string;
}

export interface ChatFeatures {
  approvals?: boolean;
  subAgents?: boolean;
  sessionPicker?: boolean;
  modelPicker?: boolean;
  /** The active model accepts image input. Default off — must be opted in. */
  vision?: boolean;
  /** The active model accepts audio input. Default off — must be opted in. */
  audio?: boolean;
}

export interface ChatHost {
  session?: AgentSession;
  approvals: ApprovalManager;
  cwd: string;
  createSession(): AgentSession;
  forkSession(id: string, upToIndex: number): Promise<AgentSession>;
  listSessions(): Promise<SessionRecord[]>;
  openSession(id: string): Promise<AgentSession>;
  selectModel(ref: string): void;
  modelRef(): string;
  listModels(): Promise<ModelInfo[]>;
  agentRef(): string;
  agentColor(): string | undefined;
  cycleAgent(): string;
  agentNames(): string[];
  subAgents: SubAgentRegistry;
  dispatchSubAgent(agent: string, task: string, parentId: string): Promise<SubAgentResult>;
  initialTheme: string;
  saveTheme(name: string): void;
  initialThinking: boolean;
  saveThinking(visible: boolean): void;
  history?: { load(): string[]; append(text: string): void };
  features?: ChatFeatures;
  /** Subscribe to model load/unload state (cold-start). Optional — only WS-backed hosts emit it. */
  subscribeModelLoading?(listener: (model: string, loading: boolean) => void): () => void;
  banner?: string;
  minimal?: boolean;
  commands?(): { name: string; description: string }[];
  runCommand?(input: string): Promise<{ ok: boolean; output?: unknown; error?: string }>;
  onExit(code: number): void;
}

const DIM = '\x1b[2m';

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};
const AUDIO_MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};
const ATTACHMENT_PLACEHOLDER = /\[(?:image|audio) #\d+\]/g;
// Cap raw attachment bytes so the base64 chat frame (~1.34x) stays under a typical
// 16MB WS payload limit, with headroom for text + JSON. Fail loudly, not silently.
const MAX_ATTACHMENT_BYTES = 11 * 1024 * 1024;

const lastAssistantText = (messages: readonly Message[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'assistant') {
      return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    }
  }
  return '';
};

const padTo = (value: string, width: number): string => {
  if (width <= 0) return '';
  const fitted = visibleWidth(value) > width ? truncateToWidth(value, width) : value;
  return fitted + ' '.repeat(Math.max(0, width - visibleWidth(fitted)));
};

interface ListRow {
  left: string;
  right: string;
}

const listView = (rows: ListRow[], selected: number, theme: Theme): Component => ({
  render: (s) => {
    if (s.width <= 0) return;
    const normal = styleToAnsi(theme.styles.commandPaletteItem);
    const sel = styleToAnsi(theme.styles.commandPaletteSelected);
    const maxLeft = rows.reduce((max, r) => Math.max(max, r.left.length), 0);
    for (let i = 0; i < rows.length && i < s.height; i++) {
      const isSel = i === selected;
      const prefix = isSel ? '› ' : '  ';
      const leftPart = `${prefix}${rows[i].left}${' '.repeat(Math.max(0, maxLeft - rows[i].left.length))}`;
      if (visibleWidth(leftPart) >= s.width) {
        s.text(0, i, `${isSel ? sel : normal}${padTo(leftPart, s.width)}${RESET}`);
        continue;
      }
      const rightAvail = s.width - visibleWidth(leftPart);
      const rightText = rows[i].right ? `  ${rows[i].right}` : '';
      const right = padTo(rightText, rightAvail);
      if (isSel) {
        s.text(0, i, `${sel}${leftPart}${right}${RESET}`);
      } else {
        s.text(0, i, `${normal}${leftPart}${DIM}${right}${RESET}`);
      }
    }
  },
});

export class ChatApp {
  private readonly tui: TUI;
  private readonly terminal: ProcessTerminal;
  private readonly editor: MultilineEditor;
  private readonly scroll: ScrollView;
  private readonly transcript = new Transcript();
  private readonly subScroll: ScrollView;
  private readonly subTranscript = new Transcript();
  private readonly themeProvider: ThemeProvider;
  private readonly commands: ChatCommand[];

  private session: AgentSession | undefined;
  private readonly features: ChatFeatures;
  private readonly banner: string | undefined;
  private readonly minimal: boolean;
  private unsubscribe: (() => void) | undefined;
  private unsubscribeTheme: (() => void) | undefined;
  private unsubscribeSubAgents: (() => void) | undefined;
  private unsubscribeModelLoading: (() => void) | undefined;
  private readonly runUnsubs = new Set<() => void>();
  private readonly activeRuns = new Set<{ session: AgentSession; handle: SubAgentHandle; cancelled: boolean }>();
  private mentionAc: AbortController | undefined;

  private readonly status: StatusState = { label: 'ready', busy: false, spinnerTick: 0, context: '' };
  private running = false;
  private readonly queue: string[] = [];
  private readonly pendingShell: { cmd: string; output: string }[] = [];
  private readonly pastes = new Map<string, string>();
  private pasteSeq = 0;
  private readonly attachments = new Map<string, ContentPart>();
  private attachSeq = 0;
  private models: ModelInfo[] = [];

  private paletteCursor = 0;
  private paletteDismissedFor = '__none__';
  private pickerMention: { start: number; query: string } | undefined;
  private pickerRanked: Candidate[] = [];
  private pickerCursor = 0;

  private history: string[];
  private historyIndex: number;
  private historyDraft = '';

  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private lastEsc = 0;
  private modelPickerOpen = false;
  private modelHandle: { close(): void } | undefined;
  private sessionPickerOpen = false;
  private sessionHandle: { close(): void } | undefined;
  private approvalQueue: PendingApproval[] = [];
  private approvalCursor = 0;
  private unsubscribeApproval: (() => void) | undefined;
  private errorText: string | undefined;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly host: ChatHost) {
    this.session = host.session;
    this.features = host.features ?? {};
    this.banner = host.banner;
    this.minimal = host.minimal ?? false;
    this.transcript.thinkingVisible = host.initialThinking;
    this.history = host.history?.load() ?? [];
    this.historyIndex = this.history.length;

    this.themeProvider = new ThemeProvider(themesByName[host.initialTheme] ?? themesByName.dark);

    this.terminal = new ProcessTerminal({
      alternateScreen: true,
      bracketedPaste: true,
      focusEvents: true,
      keyboard: true,
      mouse: { drag: true, motion: true },
    });
    this.tui = new TUI(this.terminal);

    this.editor = new MultilineEditor({
      placeholder: 'type a message…',
      onSubmit: (value) => this.submit(value),
      onChange: (value) => this.onInputChange(value),
    });
    this.editor.mentionRanges = (value, cursor) => {
      const ranges = mentionRanges(value, activeMention(value, cursor)?.start);
      for (const placeholder of this.pastes.keys()) {
        for (let i = value.indexOf(placeholder); i !== -1; i = value.indexOf(placeholder, i + placeholder.length)) {
          ranges.push({ start: i, end: i + placeholder.length });
        }
      }
      return ranges;
    };
    this.editor.onPaste = (text) => this.capturePaste(text);
    this.editor.chipColor = () => {
      const bg = this.theme().styles.commandPaletteSelected.bg;
      return bg ? fgToAnsi(bg) : '';
    };

    this.scroll = scrollView(
      { render: (s) => transcriptComponent(this.transcript, this.theme()).render(s) },
      { stickyHeader: (info) => this.stickyHeaderView(info), footer: () => this.jumpToBottomHint() },
    );
    this.subScroll = scrollView({ render: (s) => transcriptComponent(this.subTranscript, this.theme()).render(s) });

    this.commands = buildCommands(this.commandHost()).filter((c) => {
      if ((c.name === 'sessions' || c.name === 'new') && !this.feature('sessionPicker')) return false;
      if (c.name === 'model' && !this.feature('modelPicker')) return false;
      return true;
    });

    this.tui.setRoot({ render: (s) => this.root().render(s) });
    this.tui.setBackgroundColor(this.theme().colors.background);
    this.tui.setToastBackground(this.theme().colors.surface);
    this.tui.setToastForeground(this.theme().colors.text);
    this.tui.setFocus(this.editor);
    this.tui.addInputInterceptor((event) => this.intercept(event));
    this.tui.addGlobalKeybinding({ chord: { key: 'c', ctrl: true }, handler: () => this.onCtrlC() });
    this.tui.addGlobalKeybinding({ chord: { key: 't', ctrl: true }, handler: () => this.toggleTheme() });
    this.tui.addGlobalKeybinding({ chord: { key: 'o', ctrl: true }, handler: () => this.toggleExpand() });
    this.tui.addGlobalKeybinding({ chord: { key: 'end', ctrl: true }, handler: () => this.jumpToBottom() });
    this.tui.addGlobalKeybinding({ chord: { key: 'v', ctrl: true }, handler: () => void this.pasteClipboardImage() });

    this.unsubscribeTheme = this.themeProvider.subscribe(() => {
      this.tui.setBackgroundColor(this.theme().colors.background);
      this.tui.setToastBackground(this.theme().colors.surface);
      this.tui.setToastForeground(this.theme().colors.text);
      this.tui.requestRender(true);
    });

    this.unsubscribeModelLoading = this.host.subscribeModelLoading?.((model, loading) => this.onModelLoading(model, loading));

    this.bindSession();
    if (this.feature('subAgents')) {
      this.unsubscribeSubAgents = this.host.subAgents.subscribe((run) => this.onSubAgentRun(run));
    }
    if (this.feature('approvals')) {
      this.unsubscribeApproval = this.host.approvals.subscribe((req) => {
        this.approvalQueue.push(req);
        this.tui.requestRender();
      });
    }
    this.updateSpeaker();
    this.transcript.seed(this.session?.messages ?? []);
  }

  async start(): Promise<void> {
    this.tui.start();
    await this.loadModels();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribeTheme?.();
    this.unsubscribeSubAgents?.();
    this.unsubscribeApproval?.();
    this.unsubscribeModelLoading?.();
    this.clearRuns();
    this.stopSpinner();
    this.clearError();
    this.session?.abort();
    this.tui.stop();
  }

  private theme(): Theme {
    return this.themeProvider.current();
  }

  private commandHost(): CommandHost {
    return {
      newSession: () => this.newSession(),
      openModelPicker: () => this.openModelPicker(),
      toggleExpand: () => this.toggleExpand(),
      toggleThinking: () => this.toggleThinking(),
      exportContext: (args) => void this.exportContext(args),
      listSessions: () => void this.openSessionPicker(),
      quit: () => void this.stop().then(() => this.host.onExit(0)),
    };
  }

  private async openSessionPicker(): Promise<void> {
    if (this.running) {
      this.showError('Cannot switch sessions while a response is running.');
      return;
    }
    const sessions = await this.host.listSessions();
    if (sessions.length === 0) {
      this.transcript.note('No sessions yet.');
      this.tui.requestRender();
      return;
    }
    const content = this.buildSessionPicker(sessions, (id) => {
      this.sessionHandle?.close();
      if (id !== this.session?.id) void this.host.openSession(id).then((next) => this.swapSession(next));
    });
    this.sessionPickerOpen = true;
    this.sessionHandle = this.tui.showModal(content, {
      width: 72,
      border: false,
      background: this.theme().colors.surface,
      onClose: () => {
        this.sessionPickerOpen = false;
        this.tui.setFocus(this.editor);
      },
    });
  }

  private buildSessionPicker(sessions: SessionRecord[], onPick: (id: string) => void): Component {
    const currentId = this.session?.id;
    let cursor = Math.max(0, sessions.findIndex((s) => s.id === currentId));
    return {
      handleInput: (event) => {
        if (event.type !== 'key' || event.kind === 'release' || sessions.length === 0) return;
        if (event.key === 'up') cursor = (cursor - 1 + sessions.length) % sessions.length;
        else if (event.key === 'down') cursor = (cursor + 1) % sessions.length;
        else if (event.key === 'enter') onPick(sessions[cursor].id);
      },
      render: (s) => {
        if (s.width <= 0) return;
        const theme = this.theme();
        const itemSgr = styleToAnsi(theme.styles.commandPaletteItem);
        const selSgr = styleToAnsi(theme.styles.commandPaletteSelected);
        const muted = styleToAnsi(theme.styles.muted);
        const ITEM_INDENT = 2;
        const textX = ITEM_INDENT;
        const innerW = Math.max(1, s.width);

        s.text(textX, 1, `${styleToAnsi(theme.styles.title)}Sessions${RESET}`);

        const maxRows = Math.min(sessions.length, 10, Math.max(1, s.height - 6));
        const top = cursor >= maxRows ? cursor - maxRows + 1 : 0;
        for (let r = 0; r < maxRows; r++) {
          const session = sessions[top + r];
          if (!session) break;
          const isSel = top + r === cursor;
          const marker = session.id === currentId ? '● ' : '  ';
          const label = session.title || session.id;
          const body = `${marker}${label}`;
          s.text(0, 3 + r, `${isSel ? selSgr : itemSgr}${padTo(body, innerW)}${RESET}`);
        }

        const footerRow = 3 + maxRows + 1;
        s.text(textX, footerRow, `${muted}↑/↓ move · Enter open · Esc close${RESET}`);
        s.text(0, footerRow + 1, '');
      },
    };
  }

  private bindSession(): void {
    this.unsubscribe = this.session?.subscribe((event) => this.handleEvent(event));
  }

  private feature(name: keyof ChatFeatures): boolean {
    return this.features[name] !== false;
  }

  private ensureSession(): AgentSession {
    if (!this.session) {
      this.session = this.host.createSession();
      this.bindSession();
    }
    return this.session;
  }

  private clearRuns(): void {
    this.mentionAc?.abort();
    this.mentionAc = undefined;
    for (const unsub of this.runUnsubs) unsub();
    this.runUnsubs.clear();
    this.abortRuns();
  }

  private abortRuns(): void {
    for (const run of this.activeRuns) {
      run.cancelled = true;
      run.handle.cancel();
      run.session.abort();
    }
    this.activeRuns.clear();
  }

  private onSubAgentRun(run: SubAgentRun): void {
    if (run.parentId !== this.session?.id) return;
    const handle = this.transcript.appendSubAgent(run.agent, run.session.messages);
    const record = { session: run.session, handle, cancelled: false };
    this.activeRuns.add(record);
    const toolNames = new Map<string, string>();
    const unsub = run.session.subscribe((event) => {
      switch (event.type) {
        case 'tool_call': {
          toolNames.set(event.id, event.name);
          const args = formatToolArgs(event.name, event.input);
          handle.addTool(args ? `${event.name} ${args}` : event.name);
          break;
        }
        case 'turn_end':
          if (!record.cancelled) handle.finish(lastAssistantText(run.session.messages));
          this.activeRuns.delete(record);
          unsub();
          this.runUnsubs.delete(unsub);
          break;
        case 'error':
          if (!record.cancelled) handle.fail(event.error instanceof Error ? event.error.message : String(event.error));
          this.activeRuns.delete(record);
          unsub();
          this.runUnsubs.delete(unsub);
          break;
      }
      this.tui.requestRender();
    });
    this.runUnsubs.add(unsub);
    this.tui.requestRender();
  }

  private tryDispatch(text: string): boolean {
    const match = /^@([^\s]+)\s+([\s\S]+)$/.exec(text);
    if (!match) return false;
    const [, agent, task] = match;
    if (!this.host.agentNames().includes(agent)) return false;
    if (this.running) {
      this.queue.push(text);
      this.tui.requestRender();
      return true;
    }
    this.dispatchMention(agent, task, text);
    return true;
  }

  private dispatchMention(agent: string, task: string, displayText: string): void {
    const session = this.ensureSession();
    this.transcript.appendUser(displayText);
    const ac = new AbortController();
    this.mentionAc = ac;
    this.running = true;
    this.status.busy = true;
    this.setStatus('thinking…');
    this.startSpinner();
    this.tui.requestRender();
    this.host.dispatchSubAgent(agent, task, session.id)
      .then((result) => {
        if (ac.signal.aborted) return;
        this.mentionAc = undefined;
        const content =
          `The "${agent}" sub-agent was asked:\n${task}\n\nIts result:\n${result.text}\n\nUse this to respond to the user.`;
        return session.send(content);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        this.running = false;
        this.status.busy = false;
        this.stopSpinner();
        this.showError(err instanceof Error ? err.message : String(err));
      });
  }

  private swapSession(next: AgentSession): void {
    this.unsubscribe?.();
    this.clearRuns();
    this.session = next;
    this.bindSession();
    this.updateSpeaker();
    this.transcript.seed(next.messages);
    this.queue.length = 0;
    this.pendingShell.length = 0;
    this.running = false;
    this.status.busy = false;
    this.status.context = '';
    this.stopSpinner();
    this.setStatus('ready');
    this.tui.requestRender(true);
  }

  private onModelLoading(model: string, loading: boolean): void {
    const name = model.split('/').pop() ?? model;
    if (loading) {
      this.status.busy = true;
      this.setStatus(`loading ${name}…`);
      this.startSpinner();
    } else if (!this.running) {
      // Don't clobber an in-flight turn's status when the load finishes.
      this.status.busy = false;
      this.stopSpinner();
      this.setStatus('ready');
    }
    this.tui.requestRender();
  }

  private handleEvent(event: AgentSessionEvent): void {
    this.updateSpeaker();
    this.transcript.applyEvent(event);
    const label = statusFromEvent(event);
    if (label !== undefined) this.status.label = label;

    switch (event.type) {
      case 'turn_start':
        this.running = true;
        this.startSpinner();
        break;
      case 'turn_end':
        this.onTurnComplete();
        break;
      case 'usage':
        this.applyUsage(event.usage);
        break;
      case 'error': {
        const message = event.error instanceof Error ? event.error.message : String(event.error);
        this.showError(message);
        this.onTurnComplete();
        break;
      }
    }
    this.tui.requestRender();
  }

  private applyUsage(usage: { input?: number; output?: number; total?: number; contextWindow?: number }): void {
    const used = usage.total ?? ((usage.input ?? 0) + (usage.output ?? 0) || undefined);
    const total = usage.contextWindow;
    if (used !== undefined && total) {
      this.status.context = `${formatTokens(used)}/${formatTokens(total)} (${Math.round((used / total) * 100)}%)`;
    } else if (used !== undefined) {
      this.status.context = `${formatTokens(used)} tokens`;
    } else if (total) {
      this.status.context = `${formatTokens(total)} ctx`;
    }
  }

  private onTurnComplete(): void {
    this.running = false;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (!this.tryDispatch(next)) this.send(next);
      return;
    }
    this.status.busy = false;
    this.stopSpinner();
    this.setStatus('ready');
  }

  private stripFileMentions(text: string): string {
    const agents = new Set(this.host.agentNames());
    return text.replace(/(^|\s)@(\S+)/g, (match, pre, token) => (agents.has(token) ? match : `${pre}${token}`));
  }

  private send(value: string, attachments: ContentPart[] = []): void {
    const session = this.ensureSession();
    this.transcript.appendUser(value);
    const text = this.flushShellContext(this.stripFileMentions(this.stripAttachmentPlaceholders(value)));
    const content: string | ContentPart[] = attachments.length > 0
      ? [...(text ? [{ type: 'text' as const, text }] : []), ...attachments]
      : text;
    this.running = true;
    this.status.busy = true;
    this.setStatus('thinking…');
    this.startSpinner();
    this.tui.requestRender();
    session.send(content).catch((err) => {
      this.running = false;
      this.status.busy = false;
      this.stopSpinner();
      this.showError(err instanceof Error ? err.message : String(err));
    });
  }

  private capturePaste(text: string): string | undefined {
    // Empty bracketed paste: the terminal swallowed binary clipboard data (e.g. an image).
    if (!text.trim()) {
      void this.pasteClipboardImage();
      return '';
    }
    // A pasted path to a local image/audio file becomes an attachment, not literal text.
    const filePath = text.trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ');
    if (!filePath.includes('\n')) {
      const ext = extname(filePath).toLowerCase();
      if (IMAGE_MIME[ext] || AUDIO_MIME[ext]) {
        void this.attachFromFile(filePath, ext);
        return '';
      }
    }
    const lines = text.split('\n').length;
    if (lines < 2 && text.length <= 200) return undefined;
    const id = ++this.pasteSeq;
    const summary = lines > 1 ? `${lines} lines` : `${text.length} chars`;
    const placeholder = `[pasted #${id}, ${summary}]`;
    this.pastes.set(placeholder, text);
    return placeholder;
  }

  private expandPastes(text: string): string {
    let out = text;
    for (const [placeholder, content] of this.pastes) {
      out = out.split(placeholder).join(content);
    }
    return out;
  }

  private capable(kind: 'image' | 'audio'): boolean {
    return (kind === 'image' ? this.features.vision : this.features.audio) === true;
  }

  private async pasteClipboardImage(): Promise<void> {
    const img = await readClipboardImage().catch(() => undefined);
    if (!img) {
      this.setStatus('no image in clipboard');
      this.tui.requestRender();
      return;
    }
    this.addAttachment('image', img.mime, img.data);
  }

  private async attachFromFile(path: string, ext: string): Promise<void> {
    const kind: 'image' | 'audio' = IMAGE_MIME[ext] ? 'image' : 'audio';
    const mime = IMAGE_MIME[ext] ?? AUDIO_MIME[ext];
    try {
      const buf = await readFile(resolve(this.host.cwd, path));
      this.addAttachment(kind, mime, new Uint8Array(buf));
    } catch {
      this.setStatus(`could not read ${path}`);
      this.tui.requestRender();
    }
  }

  private addAttachment(kind: 'image' | 'audio', mime: string, data: Uint8Array): void {
    if (!this.capable(kind)) {
      this.setStatus(`the active model has no ${kind} capability — ${kind} not attached`);
      this.tui.requestRender();
      return;
    }
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      this.setStatus(`${kind} too large (${Math.round(data.byteLength / (1024 * 1024))}MB) — not attached`);
      this.tui.requestRender();
      return;
    }
    const placeholder = `[${kind} #${++this.attachSeq}]`;
    this.attachments.set(placeholder, kind === 'image' ? image(mime, data) : audio(mime, data));
    const value = this.editor.getValue();
    this.editor.setValue(value ? `${value} ${placeholder} ` : `${placeholder} `);
    this.onInputChange(this.editor.getValue());
    this.tui.requestRender();
  }

  private stripAttachmentPlaceholders(text: string): string {
    return text.replace(ATTACHMENT_PLACEHOLDER, '').replace(/[ \t]{2,}/g, ' ').trim();
  }

  private clearAttachments(): void {
    this.attachments.clear();
    this.attachSeq = 0;
  }

  private flushShellContext(userText: string): string {
    if (this.pendingShell.length === 0) return userText;
    const blocks = this.pendingShell
      .map((entry) => `$ ${entry.cmd}\n${entry.output}`)
      .join('\n\n');
    this.pendingShell.length = 0;
    return `<shell-output>\nShell commands the user ran locally since the last message:\n\n${blocks}\n</shell-output>\n\n${userText}`;
  }

  private submit(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (this.modelPickerOpen || this.sessionPickerOpen) return;

    this.clearError();
    const text = this.expandPastes(trimmed);
    const attachments = [...this.attachments.values()];
    this.editor.setValue('');
    this.clearPastes();
    this.clearAttachments();
    this.pushHistory(text);

    if (text.startsWith('!') || text.startsWith('$')) {
      this.runShell(text.slice(1).trim());
      return;
    }
    if (text.startsWith('/')) {
      this.runCommand(text);
      return;
    }
    if (this.tryDispatch(text)) return;

    if (this.running) {
      if (attachments.length > 0) this.setStatus('attachments are dropped for messages queued mid-turn');
      this.queue.push(text);
      this.tui.requestRender();
      return;
    }
    this.send(text, attachments);
  }

  private clearPastes(): void {
    this.pastes.clear();
    this.pasteSeq = 0;
  }

  private enqueueFromInput(): void {
    const value = this.editor.getValue().trim();
    if (!value) return;
    const text = this.expandPastes(value);
    this.editor.setValue('');
    this.clearPastes();
    this.clearAttachments();
    this.pushHistory(text);
    this.queue.push(text);
    this.tui.requestRender();
  }

  private onInputChange(value: string): void {
    for (const placeholder of this.pastes.keys()) {
      if (!value.includes(placeholder)) this.pastes.delete(placeholder);
    }
    for (const placeholder of this.attachments.keys()) {
      if (!value.includes(placeholder)) this.attachments.delete(placeholder);
    }
    if (value !== this.paletteDismissedFor) this.paletteDismissedFor = '__none__';
    const items = this.paletteItems();
    this.paletteCursor = Math.max(0, Math.min(this.paletteCursor, Math.max(0, items.length - 1)));

    if (items.length === 0) {
      const mention = activeMention(value, this.editor.cursorPos);
      if (mention) {
        this.pickerMention = mention;
        this.pickerRanked = rank(
          mention.query,
          collectCandidates(this.host.cwd, this.host.agentNames()),
          MAX_LIST_ROWS,
        );
        this.pickerCursor = Math.max(0, Math.min(this.pickerCursor, Math.max(0, this.pickerRanked.length - 1)));
      } else {
        this.pickerMention = undefined;
        this.pickerRanked = [];
      }
    } else {
      this.pickerMention = undefined;
      this.pickerRanked = [];
    }
    this.editor.hiddenPrefix = value.startsWith('/') || value.startsWith('!') || value.startsWith('$')
      ? value[0]
      : this.pickerVisible() && value.startsWith('@')
      ? '@'
      : '';
    this.tui.requestRender();
  }

  private intercept(event: InputEvent): boolean {
    if (this.modelPickerOpen || this.sessionPickerOpen) return false;
    if (event.type !== 'key' || event.kind === 'release') return false;
    const key = event.key;

    if (this.approvalQueue.length > 0) {
      const count = APPROVAL_OPTIONS.length;
      if (key === 'left' || (key === 'tab' && event.shift)) return this.moveApproval(-1);
      if (key === 'right' || (key === 'tab' && !event.shift)) return this.moveApproval(1);
      if (key === 'enter') return this.resolveApproval(APPROVAL_OPTIONS[this.approvalCursor % count].value);
      if (key === 'escape' || key === 'esc') return this.resolveApproval('deny');
      return true;
    }

    if (key === 'escape' || key === 'esc') return this.onEscape();

    if (key === 'enter' && event.alt) {
      if (this.running) {
        this.enqueueFromInput();
        return true;
      }
      return false;
    }

    if (this.paletteItems().length > 0) {
      if (key === 'up') return this.paletteMove(-1);
      if (key === 'down') return this.paletteMove(1);
      if (key === 'tab') return this.paletteComplete();
      if (key === 'enter') return this.paletteRun();
      return false;
    }

    if (this.pickerVisible()) {
      if (key === 'up') return this.pickerMove(-1);
      if (key === 'down') return this.pickerMove(1);
      if (key === 'tab' || key === 'enter') return this.pickerAccept();
      return false;
    }

    if (key === 'tab') return this.cycleAgent();

    if (key === 'up') return this.navigateHistory('up');
    if (key === 'down') return this.navigateHistory('down');

    return false;
  }

  private cycleAgent(): boolean {
    this.host.cycleAgent();
    this.tui.requestRender();
    return true;
  }

  private onEscape(): boolean {
    const focused = this.focusedSub();
    if (focused) {
      focused.open = false;
      this.tui.requestRender();
      return true;
    }
    if (this.paletteItems().length > 0) {
      this.paletteDismissedFor = this.editor.getValue();
      this.tui.requestRender();
      return true;
    }
    if (this.pickerVisible()) {
      this.pickerMention = undefined;
      this.pickerRanked = [];
      this.tui.requestRender();
      return true;
    }
    const value = this.editor.getValue();
    if (value.startsWith('!') || value.startsWith('$') || value.startsWith('/')) {
      this.editor.setValue('');
      this.tui.requestRender();
      return true;
    }
    if (this.running) {
      const now = Date.now();
      if (this.lastEsc > 0 && now - this.lastEsc < 1500) {
        this.lastEsc = 0;
        this.cancelGeneration();
      } else {
        this.lastEsc = now;
        this.setStatus('press Esc again to cancel');
        this.tui.requestRender();
      }
      return true;
    }
    return false;
  }

  private cancelGeneration(): void {
    this.queue.length = 0;
    this.mentionAc?.abort();
    this.mentionAc = undefined;
    this.abortRuns();
    this.session?.abort();
    this.onTurnComplete();
    this.tui.requestRender();
  }

  // Built-in TUI commands plus any harness commands (computed fresh so hot-reloaded
  // skill commands appear). Harness names that collide with a TUI command are dropped.
  private harnessCommands(): ChatCommand[] {
    if (!this.host.commands || !this.host.runCommand) return [];
    const taken = new Set(this.commands.map((c) => c.name));
    return this.host.commands()
      .filter((c) => !taken.has(c.name))
      .map((c): ChatCommand => ({
        name: c.name,
        description: c.description,
        run: async (args) => {
          const res = await this.host.runCommand!(`/${c.name}${args ? ` ${args}` : ''}`);
          if (res.ok) {
            if (res.output != null) this.transcript.note(String(res.output));
          } else {
            this.transcript.note(res.error ?? 'command failed', true);
          }
          this.tui.requestRender();
        },
      }));
  }

  private allCommands(): ChatCommand[] {
    return [...this.commands, ...this.harnessCommands()];
  }

  private paletteItems(): ChatCommand[] {
    return filterCommands(this.allCommands(), this.editor.getValue(), this.paletteDismissedFor).slice(0, MAX_LIST_ROWS);
  }

  private paletteMove(delta: number): boolean {
    const items = this.paletteItems();
    if (items.length === 0) return true;
    this.paletteCursor = (this.paletteCursor + delta + items.length) % items.length;
    this.tui.requestRender();
    return true;
  }

  private paletteComplete(): boolean {
    const items = this.paletteItems();
    const command = items[this.paletteCursor];
    if (!command) return true;
    const next = `/${command.name} `;
    this.editor.setValue(next);
    this.editor.setCursor(next.length);
    return true;
  }

  private paletteRun(): boolean {
    const items = this.paletteItems();
    const command = items[this.paletteCursor];
    if (!command) return true;
    this.editor.setValue('');
    void command.run('');
    return true;
  }

  private runCommand(value: string): void {
    const body = value.trim().slice(1);
    const space = body.indexOf(' ');
    const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
    const args = space === -1 ? '' : body.slice(space + 1).trim();
    const command = this.allCommands().find((c) => c.name === name);
    if (!command) {
      this.transcript.note(`Unknown command: /${name}`, true);
      this.tui.requestRender();
      return;
    }
    void command.run(args);
  }

  private pickerVisible(): boolean {
    return this.pickerMention !== undefined && this.pickerRanked.length > 0 && this.paletteItems().length === 0;
  }

  private pickerMove(delta: number): boolean {
    if (this.pickerRanked.length === 0) return true;
    this.pickerCursor = (this.pickerCursor + delta + this.pickerRanked.length) % this.pickerRanked.length;
    this.tui.requestRender();
    return true;
  }

  private pickerAccept(): boolean {
    const mention = this.pickerMention;
    const candidate = this.pickerRanked[this.pickerCursor];
    if (!mention || !candidate) return true;
    const value = this.editor.getValue();
    const cursor = this.editor.cursorPos;
    const insertion = `@${candidate.insert} `;
    const next = value.slice(0, mention.start) + insertion + value.slice(cursor);
    this.editor.setValue(next);
    this.editor.setCursor(mention.start + insertion.length);
    this.pickerMention = undefined;
    this.pickerRanked = [];
    this.tui.requestRender();
    return true;
  }

  private pushHistory(text: string): void {
    this.host.history?.append(text);
    if (this.history[this.history.length - 1] !== text) this.history.push(text);
    this.historyIndex = this.history.length;
    this.historyDraft = '';
  }

  private navigateHistory(direction: 'up' | 'down'): boolean {
    if (this.history.length === 0) return false;
    if (direction === 'up') {
      if (this.historyIndex === 0) return true;
      if (this.historyIndex === this.history.length) this.historyDraft = this.editor.getValue();
      this.historyIndex -= 1;
    } else {
      if (this.historyIndex >= this.history.length) return true;
      this.historyIndex += 1;
    }
    const value = this.historyIndex === this.history.length ? this.historyDraft : this.history[this.historyIndex];
    this.editor.setValue(value);
    this.editor.setCursor(value.length);
    this.tui.requestRender();
    return true;
  }

  private newSession(): void {
    if (this.running) {
      this.showError('Cannot start a new session while a response is running.');
      return;
    }
    this.swapSession(this.host.createSession());
  }

  private async openModelPicker(): Promise<void> {
    if (this.running) {
      this.showError('Cannot switch models while a response is running.');
      return;
    }
    if (this.models.length === 0) await this.loadModels();
    if (this.models.length === 0) {
      this.showError('No models available from the backend.');
      return;
    }
    const ref = this.host.modelRef();
    const currentId = ref.includes('/') ? ref.slice(ref.indexOf('/') + 1) : ref;
    const content = this.buildModelPicker(currentId, (id) => {
      this.modelHandle?.close();
      void this.switchModel(`local/${id}`);
    });
    this.modelPickerOpen = true;
    this.modelHandle = this.tui.showModal(content, {
      width: 60,
      border: false,
      background: this.theme().colors.surface,
      onClose: () => {
        this.modelPickerOpen = false;
        this.tui.setFocus(this.editor);
      },
    });
  }

  private buildModelPicker(currentId: string, onPick: (id: string) => void): Component {
    const models = this.models;
    const maxId = models.reduce((max, m) => Math.max(max, m.id.length), 0);
    const PADX = 0;
    let cursor = Math.max(0, models.findIndex((m) => m.id === currentId));
    return {
      handleInput: (event) => {
        if (event.type !== 'key' || event.kind === 'release' || models.length === 0) return;
        if (event.key === 'up') cursor = (cursor - 1 + models.length) % models.length;
        else if (event.key === 'down') cursor = (cursor + 1) % models.length;
        else if (event.key === 'enter') onPick(models[cursor].id);
      },
      render: (s) => {
        if (s.width <= 0) return;
        const theme = this.theme();
        const itemSgr = styleToAnsi(theme.styles.commandPaletteItem);
        const selSgr = styleToAnsi(theme.styles.commandPaletteSelected);
        const muted = styleToAnsi(theme.styles.muted);
        const ITEM_INDENT = 2;
        const textX = PADX + ITEM_INDENT;
        const innerW = Math.max(1, s.width - PADX * 2);

        s.text(textX, 1, `${styleToAnsi(theme.styles.title)}Model Picker${RESET}`);

        const maxRows = Math.min(models.length, 10, Math.max(1, s.height - 6));
        const top = cursor >= maxRows ? cursor - maxRows + 1 : 0;
        for (let r = 0; r < maxRows; r++) {
          const m = models[top + r];
          if (!m) break;
          const isSel = top + r === cursor;
          const pad = ' '.repeat(Math.max(0, maxId - m.id.length));
          const provider = m.ownedBy ? `  ${m.ownedBy}` : '';
          const indent = ' '.repeat(ITEM_INDENT);
          const body = isSel ? `${indent}${m.id}${pad}${provider}` : `${indent}${m.id}${pad}${DIM}${provider}`;
          s.text(PADX, 3 + r, `${isSel ? selSgr : itemSgr}${padTo(body, innerW)}${RESET}`);
        }

        const footerRow = 3 + maxRows + 1;
        s.text(textX, footerRow, `${muted}↑/↓ move · Enter select · Esc close${RESET}`);
        s.text(0, footerRow + 1, '');
      },
    };
  }

  private moveApproval(delta: number): boolean {
    const count = APPROVAL_OPTIONS.length;
    this.approvalCursor = (this.approvalCursor + delta + count) % count;
    this.tui.requestRender();
    return true;
  }

  private resolveApproval(action: ApprovalAction): boolean {
    const req = this.approvalQueue.shift();
    if (!req) return true;
    this.approvalCursor = 0;
    this.host.approvals.resolve(req.id, action);
    this.tui.requestRender();
    return true;
  }

  private approvalView(): Component | undefined {
    const req = this.approvalQueue[0];
    if (!req) return undefined;
    const cursor = this.approvalCursor;
    const args = formatToolArgs(req.name, req.input);
    return {
      render: (s) => {
        if (s.width <= 0) return;
        const theme = this.theme();
        const itemSgr = styleToAnsi(theme.styles.commandPaletteItem);
        const selSgr = styleToAnsi({ ...theme.styles.commandPaletteSelected, fg: '#000000' });
        const muted = styleToAnsi(theme.styles.muted);
        const innerW = Math.max(1, s.width);

        const queued = this.approvalQueue.length > 1 ? ` (+${this.approvalQueue.length - 1} more)` : '';
        const title = (req.agent ? `Tool approval · ${req.agent}` : 'Tool approval') + queued;
        s.text(0, 0, `${styleToAnsi(theme.styles.title)}${title}${RESET}`);
        const head = args ? `${req.name} ${args}` : req.name;
        s.text(0, 1, `${muted}${truncateToWidth(head, innerW)}${RESET}`);

        const choices = APPROVAL_OPTIONS
          .map((opt, r) => `${r === cursor ? selSgr : itemSgr} ${opt.label} ${RESET}`)
          .join(`${muted}  ${RESET}`);
        s.text(0, 3, choices);

        s.text(0, 4, `${muted}←/→ or tab move · Enter select · Esc deny${RESET}`);
      },
    };
  }

  private async switchModel(ref: string): Promise<void> {
    this.host.selectModel(ref);
    const current = this.session;
    const carry = current ? current.messages.some((m) => m.role !== 'system') : false;
    let next: AgentSession;
    try {
      next = carry && current
        ? await this.host.forkSession(current.id, current.messages.length - 1)
        : this.host.createSession();
    } catch {
      next = this.host.createSession();
    }
    this.swapSession(next);
    this.transcript.note(`switched model to ${ref}`);
    this.tui.requestRender();
  }

  private async exportContext(args: string): Promise<void> {
    const all = this.session?.messages ?? [];
    if (all.length === 0) {
      this.showError('Nothing to export yet.');
      return;
    }
    const outputPath = args.trim() || '.mu/context.json';
    const resolved = resolve(this.host.cwd, outputPath);
    const rel = relative(this.host.cwd, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      this.showError('Export path must stay inside the project directory.');
      return;
    }
    const system = all.filter((message) => message.role === 'system').map(textOf).join('\n\n');
    const payload = {
      exportedAt: new Date().toISOString(),
      session: {
        id: this.session?.id ?? '',
        cwd: this.host.cwd,
        agent: this.host.agentRef(),
        model: this.host.modelRef(),
      },
      request: {
        system,
        tools: (this.session?.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          ...(tool.prompt ? { prompt: tool.prompt } : {}),
        })),
        messages: all.filter((message) => message.role !== 'system'),
      },
    };
    try {
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, `${JSON.stringify(payload, encodeBinary, 2)}\n`, 'utf-8');
      this.transcript.note(`saved full context to ${outputPath}`);
    } catch (error) {
      this.showError(`Failed to export: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.tui.requestRender();
  }

  private toggleExpand(): void {
    if (this.transcript.toggleExpanded()) this.tui.requestRender();
  }

  private toggleThinking(): void {
    this.host.saveThinking(this.transcript.toggleReasoning());
    this.tui.requestRender();
  }

  private toggleTheme(): void {
    const next = this.theme().name === 'dark' ? themesByName.light : themesByName.dark;
    this.themeProvider.setTheme(next);
    this.host.saveTheme(next.name);
  }

  private onCtrlC(): void {
    if (this.editor.getValue().length > 0) {
      this.editor.setValue('');
      this.tui.requestRender();
      return;
    }
    void this.stop().then(() => this.host.onExit(130));
  }

  private recordShell(cmd: string, output: string): void {
    const MAX = 10_000;
    const capped = output.length > MAX ? `${output.slice(0, MAX)}\n…[truncated]` : output;
    this.pendingShell.push({ cmd, output: capped });
  }

  private runShell(cmd: string): void {
    if (!cmd) return;
    const handle = this.transcript.appendShell(cmd);
    this.tui.requestRender();
    let stdout = '';
    let stderr = '';
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('bash', ['-c', cmd], { cwd: this.host.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      handle.setOutput(message, true);
      this.recordShell(cmd, message);
      this.tui.requestRender();
      return;
    }
    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });
    proc.on('close', (code) => {
      const output = code !== 0 || stderr ? [stdout, stderr].filter(Boolean).join('\n') : stdout;
      const trimmed = output.trim() || '(no output)';
      handle.setOutput(trimmed, code !== 0);
      this.recordShell(cmd, code !== 0 ? `(exit ${code})\n${trimmed}` : trimmed);
      this.tui.requestRender();
    });
    proc.on('error', (err) => {
      handle.setOutput(err.message, true);
      this.recordShell(cmd, err.message);
      this.tui.requestRender();
    });
  }

  private setStatus(label: string): void {
    this.status.label = label;
  }

  private showError(message: string): void {
    this.errorText = message;
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      this.errorText = undefined;
      this.errorTimer = undefined;
      this.tui.requestRender();
    }, 6000);
    this.tui.requestRender();
  }

  private clearError(): void {
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = undefined;
    this.errorText = undefined;
  }

  private startSpinner(): void {
    this.status.busy = true;
    if (this.spinnerTimer) return;
    this.spinnerTimer = setInterval(() => {
      this.status.spinnerTick += 1;
      this.tui.requestRender();
    }, SPINNER_INTERVAL_MS);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
    this.status.busy = false;
  }

  private async loadModels(): Promise<void> {
    try {
      this.models = await this.host.listModels();
      this.tui.requestRender();
    } catch {
      // backend may be unreachable; surfaced on first send
    }
  }

  private modelLabel(): string {
    const ref = this.host.modelRef();
    const slash = ref.indexOf('/');
    const id = slash >= 0 ? ref.slice(slash + 1) : ref;
    const providerName = slash >= 0 ? ref.slice(0, slash) : '';
    const model = this.models.find((m) => m.id === id);
    const provider = model?.ownedBy ?? providerName;
    const theme = this.theme();
    const bold = styleToAnsi({ fg: theme.colors.text, bold: true });
    const dim = styleToAnsi({ fg: theme.colors.textMuted });
    const head = provider ? `${bold}${id}${RESET}  ${dim}${provider}${RESET}` : `${bold}${id}${RESET}`;
    const agent = this.host.agentRef();
    if (!agent) return head;
    const hex = asHexColor(this.host.agentColor());
    const agentSgr = hex ? styleToAnsi({ fg: hex, bold: true }) : dim;
    return `${head}  ${dim}·${RESET}  ${agentSgr}@${agent}${RESET}`;
  }

  private updateSpeaker(): void {
    this.transcript.speaker = { name: this.host.agentRef(), color: asHexColor(this.host.agentColor()) };
  }

  private promptGlyph(): string {
    const theme = this.theme();
    const muted = styleToAnsi(theme.styles.muted);
    const value = this.editor.getValue();
    if (value.startsWith('!') || value.startsWith('$')) return `${styleToAnsi(theme.styles.bashPrompt)}$ ${RESET}`;
    if (value.startsWith('/')) return `${muted}/ ${RESET}`;
    if (this.pickerVisible()) return `${muted}@ ${RESET}`;
    return `${muted}❯ ${RESET}`;
  }

  private inputPanel(): Component {
    const inner = this.approvalView() ?? this.editorInner();
    return box(inner, { background: this.theme().colors.surface, padding: 1 });
  }

  private editorInner(): Component {
    const prompt = this.promptGlyph();
    const editor = this.editor;
    const editorRows = editor.rows();
    const label = this.minimal ? '' : this.modelLabel();
    return {
      render: (s) => {
        if (s.width <= 0 || s.height <= 0) return;
        s.text(0, 0, prompt);
        const reserve = label ? 2 : 1;
        const rows = Math.min(editorRows, Math.max(1, s.height - reserve));
        s.child(editor, { x: PROMPT_WIDTH, y: 0, width: Math.max(1, s.width - PROMPT_WIDTH), height: rows });
        if (label) {
          const labelRow = rows + 1;
          s.text(0, labelRow, visibleWidth(label) > s.width ? truncateToWidth(label, s.width) : label);
        }
      },
    };
  }

  private errorView(): Component | undefined {
    const message = this.errorText;
    if (!message) return undefined;
    const theme = this.theme();
    const head = styleToAnsi(theme.styles.errorPrefix);
    const body = styleToAnsi(theme.styles.errorLine);
    return {
      render: (s) => {
        if (s.width <= 0) return;
        const text = visibleWidth(message) > s.width - 2 ? truncateToWidth(message, Math.max(1, s.width - 2)) : message;
        s.text(0, 0, `${head}!${RESET} ${body}${text}${RESET}`);
        s.text(0, 1, '');
      },
    };
  }

  private waitingView(): Component | undefined {
    if (this.queue.length === 0) return undefined;
    const theme = this.theme();
    const muted = styleToAnsi(theme.styles.muted);
    const body = styleToAnsi(theme.styles.body);
    const rows = this.queue.slice(0, 6).map((entry) => entry.replace(/\s+/g, ' '));
    return {
      render: (s) => {
        for (let i = 0; i < rows.length; i++) {
          const tag = '[follow-up] ';
          const text = padTo(rows[i], Math.max(0, s.width - tag.length));
          s.text(0, i, `${muted}${tag}${RESET}${body}${text}${RESET}`);
        }
      },
    };
  }

  private inputGroup(): Component[] {
    const children: Component[] = [];

    const error = this.errorView();
    if (error) children.push(error);

    const palette = this.paletteItems();
    if (palette.length > 0) {
      const rows = palette.map((c) => ({ left: `/${c.name}`, right: c.description }));
      children.push(listView(rows, this.paletteCursor, this.theme()));
    } else if (this.pickerVisible()) {
      const rows = this.pickerRanked.map((c) => ({ left: c.label, right: c.kind === 'file' ? '' : c.kind }));
      children.push(listView(rows, this.pickerCursor, this.theme()));
    }

    const waiting = this.waitingView();
    if (waiting) children.push(waiting);

    children.push(this.inputPanel());
    return children;
  }

  private statusBar(): Component {
    this.status.minimal = this.minimal;
    return statusComponent(this.status, this.theme());
  }

  private dock(): Component {
    return column([...this.inputGroup(), this.statusBar()]);
  }

  private jumpToBottom(): void {
    this.scroll.scrollToBottom();
    this.tui.requestRender();
  }

  private jumpToBottomHint(): Component {
    const theme = this.theme();
    const label = ' ↓ Jump to bottom (ctrl+End) ';
    const pill = styleToAnsi({ fg: theme.colors.text, bg: theme.colors.surfaceMuted });
    let pillStart = 0;
    let pillEnd = 0;
    return {
      handleInput: (event) => {
        if (event.type !== 'mouse' || event.kind !== 'press' || event.button !== 'left') return false;
        if (event.localY !== 0) return false;
        if (event.localX === undefined || event.localX < pillStart || event.localX >= pillEnd) return false;
        this.jumpToBottom();
        return true;
      },
      render: (s) => {
        if (s.width <= 0) return;
        const text = visibleWidth(label) > s.width ? truncateToWidth(label, s.width) : label;
        const width = visibleWidth(text);
        pillStart = Math.max(0, Math.floor((s.width - width) / 2));
        pillEnd = pillStart + width;
        s.text(pillStart, 0, `${pill}${text}${RESET}`);
        s.text(0, 1, '');
      },
    };
  }

  private stickyHeaderView(info: { scrollY: number; width: number }): Component | undefined {
    const gov = this.governingUser(info.scrollY, info.width);
    if (!gov || info.scrollY < gov.endRow) return undefined;
    return stickyHeader(gov.text, this.theme());
  }

  private governingUser(scrollY: number, width: number): { text: string; endRow: number } | undefined {
    if (width <= 0) return undefined;
    const theme = this.theme();
    const expanded = this.transcript.expanded;
    let y = 0;
    let current: { text: string; endRow: number } | undefined;
    for (const entry of this.transcript.entries) {
      if (y > scrollY) break;
      const margin = entry.kind === 'tool_call' ? 0 : 1;
      const height = measure(entryComponent(entry, theme, expanded), width) + margin;
      if (entry.kind === 'user') current = { text: entry.text, endRow: y + height };
      y += height;
    }
    return current;
  }

  private focusedSub(): SubAgentEntry | undefined {
    for (const entry of this.transcript.entries) {
      if (entry.kind === 'subagent' && entry.open) return entry;
    }
    return undefined;
  }

  private subAgentHeader(entry: SubAgentEntry): Component {
    const theme = this.theme();
    const color = entry.status === 'done'
      ? theme.colors.success
      : entry.status === 'error'
      ? theme.styles.errorPrefix.fg ?? theme.colors.danger
      : entry.status === 'canceled'
      ? theme.colors.textMuted
      : theme.colors.accent;
    const accent = styleToAnsi({ fg: color, bold: true });
    const muted = styleToAnsi(theme.styles.muted);
    const line = `${accent}▌ ${entry.agent}${RESET}${muted} sub-agent · ${entry.status}  ·  esc to close${RESET}`;
    return {
      render: (s) => {
        if (s.width <= 0) return;
        s.text(0, 0, visibleWidth(line) > s.width ? truncateToWidth(line, s.width) : line);
        s.text(0, 1, '');
      },
    };
  }

  private subAgentView(entry: SubAgentEntry): Component {
    this.subTranscript.seed(entry.messages ?? []);
    return column([this.subAgentHeader(entry), flex(this.subScroll)]);
  }

  private centered(child: Component, maxW: number): Component {
    return {
      render: (s) => {
        const w = Math.max(0, Math.min(maxW, s.width));
        if (w === 0) return;
        const h = s.measure(child, w);
        const x = Math.max(0, Math.floor((s.width - w) / 2));
        s.child(child, { x, y: 0, width: w, height: h });
      },
    };
  }

  private bannerBlock(): Component {
    const theme = this.theme();
    const sgr = styleToAnsi({ fg: theme.colors.accent, bold: true });
    const lines = (this.banner ?? '').split('\n');
    const blockW = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
    return {
      render: (s) => {
        if (s.width <= 0) return;
        const x = Math.max(0, Math.floor((s.width - blockW) / 2));
        for (let i = 0; i < lines.length; i++) s.text(x, i, `${sgr}${lines[i]}${RESET}`);
        s.text(0, lines.length, '');
      },
    };
  }

  private root(): Component {
    const focused = this.focusedSub();
    const showBanner = this.banner !== undefined && this.transcript.entries.length === 0 && !focused;
    const spacer: Component = { render: () => {} };
    const inner = focused ? this.subAgentView(focused) : showBanner
      // Splash: banner + a centered, width-limited minimal input; status pinned at the bottom.
      ? column([
        flex(spacer),
        this.bannerBlock(),
        this.centered(column(this.inputGroup()), SPLASH_INPUT_WIDTH),
        flex(spacer),
        this.statusBar(),
      ])
      // Conversation: transcript fills, input docked at the bottom.
      : column([flex(this.scroll), this.dock()]);
    return {
      render: (s) => {
        s.fill({ x: 0, y: 0, width: s.width, height: s.height }, this.theme().colors.background);
        if (s.width <= 2) {
          inner.render(s);
          return;
        }
        s.child(inner, { x: 1, y: 0, width: s.width - 2, height: s.height });
      },
    };
  }
}
