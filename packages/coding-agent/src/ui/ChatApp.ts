import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  AgentSession,
  AgentSessionEvent,
  ApprovalAction,
  ApprovalManager,
  PendingApproval,
  SubAgentRegistry,
  SubAgentResult,
  SubAgentRun,
} from 'mu-harness';
import type { Message } from 'mu-core';
import {
  box,
  column,
  type Component,
  flex,
  type InputEvent,
  ProcessTerminal,
  type ScrollView,
  scrollView,
  truncateToWidth,
  TUI,
  visibleWidth,
} from 'mu-tui';
import { appendHistory, loadHistory } from '../config';
import { MultilineEditor } from './editor';
import { buildCommands, type ChatCommand, type CommandHost, filterCommands } from './commands';
import { activeMention, type Candidate, collectCandidates, rank } from './picker';
import { formatTokens, statusComponent, statusFromEvent, type StatusState } from './status';
import { asHexColor, styleToAnsi, type Theme, ThemeProvider, themesByName } from './theme';
import { formatToolArgs, type SubAgentEntry, type SubAgentHandle, Transcript, transcriptComponent } from './transcript';

const RESET = '\x1b[0m';
const PROMPT_WIDTH = 2;
const SPINNER_INTERVAL_MS = 100;
const MAX_LIST_ROWS = 8;

const APPROVAL_OPTIONS: { label: string; value: ApprovalAction }[] = [
  { label: 'Approve once', value: 'approve' },
  { label: 'Approve for this session', value: 'approve_always' },
  { label: 'Deny', value: 'deny' },
];

export interface ModelInfo {
  id: string;
  ownedBy?: string;
}

export interface ChatHost {
  session: AgentSession;
  approvals: ApprovalManager;
  cwd: string;
  createSession(): AgentSession;
  forkSession(id: string, upToIndex: number): Promise<AgentSession>;
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
  onExit(code: number): void;
}

const DIM = '\x1b[2m';

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

  private session: AgentSession;
  private unsubscribe: (() => void) | undefined;
  private unsubscribeTheme: (() => void) | undefined;
  private unsubscribeSubAgents: (() => void) | undefined;
  private readonly runUnsubs = new Set<() => void>();
  private readonly activeRuns = new Set<{ session: AgentSession; handle: SubAgentHandle; cancelled: boolean }>();
  private mentionAc: AbortController | undefined;

  private readonly status: StatusState = { label: 'ready', busy: false, spinnerTick: 0, context: '' };
  private running = false;
  private readonly queue: string[] = [];
  private readonly pendingShell: { cmd: string; output: string }[] = [];
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
  private approvalQueue: PendingApproval[] = [];
  private approvalCursor = 0;
  private unsubscribeApproval: (() => void) | undefined;
  private errorText: string | undefined;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly host: ChatHost) {
    this.session = host.session;
    this.transcript.thinkingVisible = host.initialThinking;
    this.history = loadHistory();
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

    this.scroll = scrollView({ render: (s) => transcriptComponent(this.transcript, this.theme()).render(s) });
    this.subScroll = scrollView({ render: (s) => transcriptComponent(this.subTranscript, this.theme()).render(s) });

    this.commands = buildCommands(this.commandHost());

    this.tui.setRoot({ render: (s) => this.root().render(s) });
    this.tui.setBackgroundColor(this.theme().colors.background);
    this.tui.setFocus(this.editor);
    this.tui.addInputInterceptor((event) => this.intercept(event));
    this.tui.addGlobalKeybinding({ chord: { key: 'c', ctrl: true }, handler: () => this.onCtrlC() });
    this.tui.addGlobalKeybinding({ chord: { key: 't', ctrl: true }, handler: () => this.toggleTheme() });
    this.tui.addGlobalKeybinding({ chord: { key: 'o', ctrl: true }, handler: () => this.toggleExpand() });

    this.unsubscribeTheme = this.themeProvider.subscribe(() => {
      this.tui.setBackgroundColor(this.theme().colors.background);
      this.tui.requestRender(true);
    });

    this.bindSession();
    this.unsubscribeSubAgents = this.host.subAgents.subscribe((run) => this.onSubAgentRun(run));
    this.unsubscribeApproval = this.host.approvals.subscribe((req) => {
      this.approvalQueue.push(req);
      this.tui.requestRender();
    });
    this.transcript.seed(this.session.messages);
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
    this.clearRuns();
    this.stopSpinner();
    this.clearError();
    this.session.abort();
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
      quit: () => void this.stop().then(() => this.host.onExit(0)),
    };
  }

  private bindSession(): void {
    this.unsubscribe = this.session.subscribe((event) => this.handleEvent(event));
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
    if (run.parentId !== this.session.id) return;
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
    this.transcript.appendUser(displayText);
    const ac = new AbortController();
    this.mentionAc = ac;
    this.running = true;
    this.status.busy = true;
    this.setStatus('thinking…');
    this.startSpinner();
    this.tui.requestRender();
    this.host.dispatchSubAgent(agent, task, this.session.id)
      .then((result) => {
        if (ac.signal.aborted) return;
        this.mentionAc = undefined;
        const content =
          `The "${agent}" sub-agent was asked:\n${task}\n\nIts result:\n${result.text}\n\nUse this to respond to the user.`;
        return this.session.send(content);
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

  private handleEvent(event: AgentSessionEvent): void {
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

  private send(value: string): void {
    this.transcript.appendUser(value);
    const content = this.flushShellContext(value);
    this.running = true;
    this.status.busy = true;
    this.setStatus('thinking…');
    this.startSpinner();
    this.tui.requestRender();
    this.session.send(content).catch((err) => {
      this.running = false;
      this.status.busy = false;
      this.stopSpinner();
      this.showError(err instanceof Error ? err.message : String(err));
    });
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
    if (this.modelPickerOpen) return;

    this.clearError();
    this.pushHistory(trimmed);
    this.editor.setValue('');

    if (trimmed.startsWith('!') || trimmed.startsWith('$')) {
      this.runShell(trimmed.slice(1).trim());
      return;
    }
    if (trimmed.startsWith('/')) {
      this.runCommand(trimmed);
      return;
    }
    if (this.tryDispatch(trimmed)) return;

    if (this.running) {
      this.queue.push(trimmed);
      this.tui.requestRender();
      return;
    }
    this.send(trimmed);
  }

  private enqueueFromInput(): void {
    const value = this.editor.getValue().trim();
    if (!value) return;
    this.pushHistory(value);
    this.editor.setValue('');
    this.queue.push(value);
    this.tui.requestRender();
  }

  private onInputChange(value: string): void {
    this.editor.hiddenPrefix = value.startsWith('/') || value.startsWith('!') || value.startsWith('$') ? value[0] : '';
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
    this.tui.requestRender();
  }

  private intercept(event: InputEvent): boolean {
    if (this.modelPickerOpen) return false;
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

    if (key === 'backspace') {
      if (this.deleteMention()) return true;
      return false;
    }

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
    this.session.abort();
    this.onTurnComplete();
    this.tui.requestRender();
  }

  private paletteItems(): ChatCommand[] {
    return filterCommands(this.commands, this.editor.getValue(), this.paletteDismissedFor).slice(0, MAX_LIST_ROWS);
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
    const command = this.commands.find((c) => c.name === name);
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

  private deleteMention(): boolean {
    const value = this.editor.getValue();
    const cursor = this.editor.cursorPos;
    const re = /@[^\s]+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (cursor > start && cursor <= end) {
        this.editor.setValue(value.slice(0, start) + value.slice(end));
        this.editor.setCursor(start);
        this.tui.requestRender();
        return true;
      }
    }
    return false;
  }

  private pushHistory(text: string): void {
    appendHistory(text);
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
    const carry = this.session.messages.some((m) => m.role !== 'system');
    let next: AgentSession;
    try {
      next = carry
        ? await this.host.forkSession(this.session.id, this.session.messages.length - 1)
        : this.host.createSession();
    } catch {
      next = this.host.createSession();
    }
    this.swapSession(next);
    this.transcript.note(`switched model to ${ref}`);
    this.tui.requestRender();
  }

  private async exportContext(args: string): Promise<void> {
    const messages = this.session.messages.filter((m) => m.role !== 'system');
    if (messages.length === 0) {
      this.showError('Nothing to export yet.');
      return;
    }
    const outputPath = args.trim() || '.mu/context.json';
    const resolved = resolve(this.host.cwd, outputPath);
    const payload = { exportedAt: new Date().toISOString(), model: this.host.modelRef(), messages };
    try {
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
      this.transcript.note(`saved conversation to ${outputPath}`);
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
    const label = this.modelLabel();
    const editorRows = editor.rows();
    return {
      render: (s) => {
        if (s.width <= 0 || s.height <= 0) return;
        s.text(0, 0, prompt);
        const rows = Math.min(editorRows, Math.max(1, s.height - 2));
        s.child(editor, { x: PROMPT_WIDTH, y: 0, width: Math.max(1, s.width - PROMPT_WIDTH), height: rows });
        const labelRow = rows + 1;
        s.text(0, labelRow, visibleWidth(label) > s.width ? truncateToWidth(label, s.width) : label);
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

  private dock(): Component {
    const children: Component[] = [];

    const error = this.errorView();
    if (error) children.push(error);

    const palette = this.paletteItems();
    if (palette.length > 0) {
      const rows = palette.map((c) => ({ left: `/${c.name}`, right: c.description }));
      children.push(listView(rows, this.paletteCursor, this.theme()));
    } else if (this.pickerVisible()) {
      const rows = this.pickerRanked.map((c) => ({ left: c.label, right: c.kind === 'agent' ? 'agent' : '' }));
      children.push(listView(rows, this.pickerCursor, this.theme()));
    }

    const waiting = this.waitingView();
    if (waiting) children.push(waiting);

    children.push(this.inputPanel());

    children.push(statusComponent(this.status, this.theme()));
    return column(children);
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

  private root(): Component {
    const focused = this.focusedSub();
    const inner = focused ? this.subAgentView(focused) : column([flex(this.scroll), this.dock()]);
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
