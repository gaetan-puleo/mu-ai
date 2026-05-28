import type { CoreEvent, EventBus, LLMResponseContext, Message, Runtime } from 'mu-core';
import { appendHistory, loadHistory } from '../config';
import {
  createDeferredCommandQueue,
  createInputHistory,
  type DeferredCommandQueue,
  type InputHistory,
  type Model,
  parseAgentRouting,
  RoundtripStore,
  statusFromEvent,
} from 'mu-harness';
import { type Component, type InputEvent, ProcessTerminal, TUI } from 'mu-tui';
import { Box, Input, type InputHighlight, ScrollView, Text } from 'mu-tui/components';
import { CommandPalette } from './components/CommandPalette';
import { ErrorToast } from './components/SimpleLines';
import { type WaitingItem, WaitingList } from './components/WaitingList';
import { buildStatusParts, formatTokens, StatusLine } from './statusLine';
import { asHexColor, darkTheme, lightTheme, styleToAnsi, type Theme, ThemeProvider } from './theme';
import { Transcript } from './Transcript';
import type { AgentDisplay } from './chatApp/picker';
import { FilePickerController, ModelPickerController } from './chatApp/picker';
import { buildSubAgentViewComponents, buildTranscriptComponents } from './chatApp/transcript';
import {
  buildCommandRegistry,
  type ChatCommand,
  type ChatCommandRegistry,
  exportContextToFile,
  filterCommands,
  runShellCommand,
  toggleOutputBlocksInTranscript,
} from './chatApp/commands';
import { SubAgentController } from './chatApp/subAgents';

type ChatBus = EventBus<CoreEvent>;

interface ModelController {
  createRuntime: () => Runtime;
  listModels: () => Promise<Model[]>;
  readonly model: string;
  setModel: (model: string) => void;
}

interface ChatAppOptions {
  thinkingVisible?: boolean;
  onThinkingVisibleChange?: (visible: boolean) => void;
  /** Every switchable primary agent. Empty/single → Tab switching disabled. */
  primaryAgents?: AgentDisplay[];
  /** Returns the currently active primary (or undefined). */
  getActivePrimary?: () => AgentDisplay | undefined;
  /** Called when the user cycles the active primary (Tab). */
  setActivePrimary?: (next: AgentDisplay) => void;
  /**
   * One-shot override set when the user submits a message with `@<primary>`.
   * Passing `undefined` clears it. Cleared automatically when the runtime
   * returns to idle.
   */
  setOverridePrimary?: (next: AgentDisplay | undefined) => void;
  /** Sub-agents available for @-mention in the file picker dropdown. */
  subAgents?: AgentDisplay[];
  /**
   * Dispatch a sub-agent in an isolated runtime. Called when the user submits
   * a message starting with `@<sub-agent>`. The result is rendered as a
   * sub-agent block in the transcript; the main runtime never sees the turn.
   * `onEvent` receives every `CoreEvent` from the isolated runtime so the UI
   * can stream activity live.
   */
  dispatchSubAgent?: (
    name: string,
    task: string,
    onEvent?: (event: CoreEvent) => void,
  ) => Promise<{ content: string; error?: string }>;
}

const SPINNER_INTERVAL_MS = 100;

export class ChatApp {
  private tui: TUI;
  private terminal: ProcessTerminal;
  private runtime: Runtime;
  private bus: ChatBus;
  private transcript: Transcript;
  private scrollView: ScrollView;
  private transcriptBox: Box;
  private root: Box;
  private input: Input;
  private inputRow: Box;
  private inputBox: Box;
  private bottomDock: Box;
  private statusText: StatusLine;
  private statusBox: Box;
  private toastZone: Box;
  private defaultPrompt: Text;
  private bashPrompt: Text;
  private bashMode = false;
  private modelLabel: Text;
  private inputTopWidgetZone: Box;
  private inputBottomWidgetZone: Box;
  private commandPalette: CommandPalette | undefined;
  private commands!: ChatCommandRegistry;
  private commandCursor = 0;
  private dismissedPaletteFor = '';
  private modelPicker: ModelPickerController;
  private mountedModal: Component | undefined;
  private unsubscribe: (() => void) | undefined;
  private stopped = false;
  private status = 'ready';
  private contextText = '';
  private roundtrips = new RoundtripStore();
  private themeProvider: ThemeProvider;
  private unsubscribeTheme: (() => void) | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private spinnerTick = 0;
  private filePicker: FilePickerController;
  private lastEscTime = 0;
  private history!: InputHistory;
  private deferredCommandQueue!: DeferredCommandQueue<{ label: string; run: () => void }>;
  private waitingList: WaitingList | undefined;
  private overrideIdleTimer: ReturnType<typeof setInterval> | undefined;
  private overrideActive = false;
  private subAgents: SubAgentController;

  constructor(
    runtime: Runtime,
    bus: ChatBus,
    private readonly modelController?: ModelController,
    private readonly onExit?: (code: number) => void,
    private readonly options: ChatAppOptions = {},
  ) {
    this.runtime = runtime;
    this.bus = bus;
    this.history = createInputHistory({ initial: loadHistory(), onAppend: appendHistory });
    this.transcript = new Transcript(options.thinkingVisible ?? true);

    this.deferredCommandQueue = createDeferredCommandQueue<{ label: string; run: () => void }>({
      canDrain: () => this.runtime.state() === 'idle',
      runEntry: (entry) => entry.run(),
      onChange: () => this.updateWaitingList(),
    });

    this.themeProvider = new ThemeProvider(darkTheme);
    const theme = this.themeProvider.current();

    this.terminal = new ProcessTerminal({
      alternateScreen: true,
      keyboard: true,
      mouse: { drag: true, motion: true },
      focusEvents: true,
    });
    this.tui = new TUI(this.terminal, { userContext: this.themeProvider });

    this.scrollView = new ScrollView({ layout: { width: 'fill', height: 'fill' }, focusable: false });
    this.transcriptBox = new Box({
      layout: { width: 'fill', height: 'fill', overflow: 'hidden' },
      children: [this.scrollView],
    });

    this.statusText = new StatusLine();
    this.statusBox = new Box({ layout: { width: 'fill', height: 1, zIndex: 10 }, children: [this.statusText] });
    this.toastZone = new Box({ layout: { width: 'fill', height: 0, zIndex: 20 }, children: [] });

    this.input = this.createInput(theme);
    this.defaultPrompt = this.createDefaultPrompt(theme);
    this.bashPrompt = this.createBashPrompt(theme);
    this.inputTopWidgetZone = new Box({ layout: { width: 'fill', height: 0, zIndex: 10 }, children: [] });
    this.inputBottomWidgetZone = new Box({ layout: { width: 'fill', height: 0, zIndex: 10 }, children: [] });
    this.modelLabel = new Text({
      text: '',
      wrap: false,
      layout: { width: 'fill', height: 1, margin: { top: 1 } },
    });
    this.updateModelLabel();

    this.inputRow = new Box({
      layout: { width: 'fill', height: 1, direction: 'row' },
      children: [this.defaultPrompt, this.input],
    });

    this.inputBox = new Box({
      layout: {
        width: 'fill',
        height: 5,
        direction: 'column',
        padding: { top: 1, bottom: 1, right: 1, left: 1 },
        backgroundColor: theme.colors.surface,
        zIndex: 10,
      },
      children: [this.inputRow, this.modelLabel],
    });

    this.bottomDock = new Box({
      layout: { width: 'fill', height: 6, direction: 'column', zIndex: 10 },
      children: [this.toastZone, this.inputTopWidgetZone, this.inputBox, this.inputBottomWidgetZone, this.statusBox],
    });

    this.commands = buildCommandRegistry({
      startNewSession: () => void this.startNewSession(),
      openModelModal: () => this.openModelModal(),
      exportContext: (args) => void this.exportContext(args),
      toggleThinking: () => this.handleToggleThinking(),
      toggleOutputBlocks: () => this.toggleOutputBlocks(),
      stopAndExit: (code) => void this.stop().then(() => this.onExit?.(code)),
    });

    this.root = new Box({
      layout: {
        width: 'fill',
        height: 'fill',
        direction: 'column',
        padding: { left: 1, right: 1 },
        backgroundColor: theme.colors.background,
      },
      children: [this.transcriptBox, this.bottomDock],
    });

    // FilePicker + SubAgent controllers — both delegate state in/out of this
    // class so the orchestrator only deals with composition, not the inner
    // state machines.
    this.filePicker = new FilePickerController({
      input: this.input,
      collectMentionableAgents: () => this.collectMentionableAgents(),
      mount: (component, height) => this.mountTopWidget(component, height),
      onValueChanged: (value) => this.updateHighlights(value),
      requestRender: () => this.tui.requestRender(),
    });
    this.subAgents = new SubAgentController({
      transcript: this.transcript,
      renderTranscript: () => this.renderTranscript(),
      setStatus: (s) => this.setStatus(s),
      setInputVisible: (v) => this.setInputVisible(v),
      publish: (event) => this.bus.publish(event),
      requestRender: () => this.tui.requestRender(),
      dispatch: options.dispatchSubAgent,
    });
    this.modelPicker = new ModelPickerController({
      runtimeState: () => this.runtime.state(),
      mountModal: (modal) => this.mountRootModal(modal),
      setFocus: (component) => this.tui.setFocus(component),
      restoreFocus: () => this.tui.setFocus(this.input),
      requestRender: (force) => this.tui.requestRender(force),
      setStatus: (s) => this.setStatus(s),
    }, this.modelController);

    this.tui.addChild(this.root);
    this.tui.setFocus(this.input);
    this.tui.addInputInterceptor((event) => this.interceptInput(event));

    this.tui.addGlobalKeybinding({ chord: { key: 'c', ctrl: true }, handler: () => this.handleCtrlC() });
    this.tui.addGlobalKeybinding({ chord: { key: 't', ctrl: true }, handler: () => this.toggleTheme() });
    this.tui.addGlobalKeybinding({ chord: { key: 'o', ctrl: true }, handler: () => this.toggleOutputBlocks() });

    this.unsubscribeTheme = this.themeProvider.subscribe((next) => this.applyTheme(next));
    this.updateStatusLine();
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    this.unsubscribe = this.bus.subscribe((event) => this.handleEvent(event));
    await this.runtime.start();
    await this.loadModels();
    this.tui.start();
  }

  private async loadModels(): Promise<void> {
    if (!this.modelController) return;
    try {
      this.modelPicker.setList(await this.modelController.listModels());
      this.updateModelLabel();
      this.tui.requestRender();
    } catch { /* ignore */ }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = undefined;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = undefined;
    this.deferredCommandQueue.clear();
    this.stopOverrideTimer();
    this.stopSpinner();
    this.input.stop();
    await this.runtime.stop();
    this.tui.stop();
  }

  // --- Theme ---

  private createInput(theme: Theme): Input {
    return new Input({
      placeholder: 'type a message...',
      placeholderStyle: styleToAnsi(theme.styles.muted),
      textStyle: styleToAnsi(theme.styles.body),
      hiddenPrefix: '!',
      onChange: (value: string) => this.updateInputHeight(value),
      onSubmit: (value: string) => this.handleSubmit(value),
      requestRedraw: () => this.tui.requestRender(),
      layout: { width: 'fill', height: 1, zIndex: 10 },
    });
  }

  private createDefaultPrompt(theme: Theme): Text {
    return new Text({
      text: `${styleToAnsi(theme.styles.muted)}❯\x1b[0m`,
      wrap: false,
      layout: { width: 2, height: 1, zIndex: 10 },
    });
  }

  private createBashPrompt(theme: Theme): Text {
    return new Text({
      text: `${styleToAnsi(theme.styles.bashPrompt)}$\x1b[0m `,
      wrap: false,
      layout: { width: 2, height: 1, zIndex: 10 },
    });
  }

  private applyTheme(theme: Theme): void {
    if (this.root.layout) this.root.layout.backgroundColor = theme.colors.background;
    if (this.inputBox.layout) this.inputBox.layout.backgroundColor = theme.colors.surface;
    this.input.placeholderStyle = styleToAnsi(theme.styles.muted);
    this.input.textStyle = styleToAnsi(theme.styles.body);
    this.defaultPrompt.setText(`${styleToAnsi(theme.styles.muted)}❯\x1b[0m`);
    this.bashPrompt.setText(`${styleToAnsi(theme.styles.bashPrompt)}$\x1b[0m `);
    this.renderTranscript();
    this.tui.setUserContext(this.themeProvider);
  }

  private toggleTheme(): void {
    const next = this.themeProvider.current().name === 'dark' ? lightTheme : darkTheme;
    this.themeProvider.setTheme(next);
  }

  // --- Status ---

  private setStatus(status: string): void {
    this.status = status;
    const busy = this.isBusyStatus(status);
    this.statusText.setBusy(busy);
    if (busy) this.startSpinner();
    else this.stopSpinner();
    this.updateStatusLine();
  }

  private isBusyStatus(status: string): boolean {
    return (
      status === 'thinking...' ||
      status === 'streaming...' ||
      status === 'reasoning...' ||
      status === 'queued follow-up' ||
      status.startsWith('tool: ')
    );
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.statusText.setSpinnerTick(this.spinnerTick);
    this.spinnerTimer = setInterval(() => {
      this.spinnerTick++;
      this.statusText.setSpinnerTick(this.spinnerTick);
      this.tui.requestRender();
    }, SPINNER_INTERVAL_MS);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
    this.statusText.setBusy(false);
  }

  private setContext(context: LLMResponseContext): void {
    const roundtrip = this.roundtrips.record(context, this.modelController?.model);
    const used = roundtrip.usedTokens;
    const total = roundtrip.windowTokens;
    this.contextText = used !== undefined && total !== undefined
      ? `${formatTokens(used)}/${formatTokens(total)} (${Math.round((used / total) * 100)}%)`
      : '';
    this.updateStatusLine();
  }

  private canCyclePrimaryAgent(): boolean {
    return (this.options.primaryAgents?.length ?? 0) > 1 && !!this.options.setActivePrimary;
  }

  /** Agents shown in the @-mention dropdown: sub-agents + every primary except the active one. */
  private collectMentionableAgents(): AgentDisplay[] {
    const active = this.options.getActivePrimary?.();
    const primaries = (this.options.primaryAgents ?? []).filter((a) => !active || a.name !== active.name);
    const subs = this.options.subAgents ?? [];
    const seen = new Set<string>();
    const out: AgentDisplay[] = [];
    for (const a of [...primaries, ...subs]) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      out.push(a);
    }
    return out;
  }

  private cyclePrimaryAgent(direction: 1 | -1): void {
    const agents = this.options.primaryAgents ?? [];
    if (agents.length < 2) return;
    const current = this.options.getActivePrimary?.();
    const idx = current ? agents.findIndex((a) => a.name === current.name) : -1;
    const nextIdx = ((idx + direction) % agents.length + agents.length) % agents.length;
    this.options.setActivePrimary?.(agents[nextIdx]);
    this.updateModelLabel();
    this.tui.requestRender();
  }

  private updateModelLabel(): void {
    const modelId = this.modelController?.model ?? '';
    const agent = this.options.getActivePrimary?.();
    if (!modelId && !agent) {
      this.modelLabel.setText('');
      return;
    }
    const theme = this.themeProvider.current();
    const white = styleToAnsi({ fg: theme.colors.text });
    const dim = styleToAnsi({ fg: theme.colors.textMuted });
    const reset = '\x1b[0m';
    const parts: string[] = [];
    if (agent) {
      const agentHex = asHexColor(agent.color);
      const dotColor = agentHex ? styleToAnsi({ fg: agentHex }) : '';
      const dot = `${dotColor}●${reset}`;
      const displayName = agent.name.charAt(0).toUpperCase() + agent.name.slice(1);
      parts.push(`${dot} ${white}${displayName}${reset}`);
    }
    if (modelId) {
      const model = this.modelPicker.list.find((m) => m.id === modelId);
      const provider = model?.ownedBy ? `  ${dim}${model.ownedBy}${reset}` : '';
      parts.push(`${white}${modelId}${reset}${provider}`);
    }
    this.modelLabel.setText(parts.join(`  ${dim}·${reset}  `));
  }

  private updateStatusLine(): void {
    this.updateModelLabel();
    const { left, right } = buildStatusParts(this.contextText);
    this.statusText.setContent(left, right);
  }

  // --- Toast ---

  private showErrorToast(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastZone.children = [new ErrorToast(message)];
    if (this.toastZone.layout) this.toastZone.layout.height = 2;
    this.updateDockHeight();
    this.toastTimer = setTimeout(() => this.clearToast(), 6000);
  }

  private clearToast(): boolean {
    const hadToast = this.toastZone.children.length > 0;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = undefined;
    this.toastZone.children = [];
    if (this.toastZone.layout) this.toastZone.layout.height = 0;
    if (hadToast) {
      this.updateDockHeight();
      this.tui.requestRender();
    }
    return hadToast;
  }

  // --- Input ---

  private handleCtrlC(): void {
    if (this.input.value.length > 0) {
      this.input.setValue('');
      this.tui.requestRender();
      return;
    }
    void this.stop().then(() => this.onExit?.(130));
  }

  private handleSubmit(value: string): void {
    const text = value.trim();
    if (!text) return;
    // Sub-agent screen is read-only — ignore any stray submits.
    if (this.subAgents.viewing) return;

    this.pushHistory(text);

    if (this.runCommand(text)) {
      this.input.setValue('');
      this.updateCommandPalette('');
      this.tui.requestRender();
      return;
    }

    this.input.setValue('');
    this.clearToast();
    this.updateCommandPalette('');
    const isSteering = this.runtime.state() !== 'idle';

    if (!isSteering) {
      const routing = parseAgentRouting<AgentDisplay>(text, {
        primaryAgents: this.options.primaryAgents,
        subAgents: this.options.subAgents,
      });
      if (routing.kind === 'dispatch') {
        this.transcript.appendUser(text);
        this.renderTranscript();
        this.subAgents.dispatch(routing.agent, routing.task);
        return;
      }
      this.transcript.appendUser(text);
      if (routing.kind === 'override') {
        this.applyOverrideAgent(routing.agent);
      }
    }
    this.setStatus('thinking...');

    const message: Message = { role: 'user', content: text };
    if (isSteering) {
      this.transcript.appendVisibleQueuedMessage(message, 'steering');
      this.updateWaitingList();
    }
    this.renderTranscript();
    this.bus.publish({ type: isSteering ? 'steer' : 'user_message', message });
  }

  private applyOverrideAgent(target: AgentDisplay): void {
    if (!this.options.setOverridePrimary) return;
    const current = this.options.getActivePrimary?.();
    if (current && current.name === target.name) return;
    this.options.setOverridePrimary(target);
    this.overrideActive = true;
    this.updateModelLabel();
    this.scheduleOverrideClear();
  }

  private setInputVisible(visible: boolean): void {
    if (!this.inputBox.layout) return;
    if (visible) {
      // Restore to whatever the input value currently needs.
      this.updateInputHeight(this.input.value);
    } else {
      this.inputBox.layout.height = 0;
      // Also hide the auxiliary zones above/below the input.
      if (this.inputTopWidgetZone.layout) this.inputTopWidgetZone.layout.height = 0;
      if (this.inputBottomWidgetZone.layout) this.inputBottomWidgetZone.layout.height = 0;
      this.updateDockHeight();
    }
    this.tui.requestRender();
  }

  private scheduleOverrideClear(): void {
    if (this.overrideIdleTimer) return;
    this.overrideIdleTimer = setInterval(() => {
      if (this.stopped) {
        this.stopOverrideTimer();
        return;
      }
      if (this.runtime.state() === 'idle') {
        this.stopOverrideTimer();
        if (this.overrideActive) {
          this.overrideActive = false;
          this.options.setOverridePrimary?.(undefined);
          this.updateModelLabel();
          this.tui.requestRender();
        }
      }
    }, 200);
  }

  private stopOverrideTimer(): void {
    if (this.overrideIdleTimer) {
      clearInterval(this.overrideIdleTimer);
      this.overrideIdleTimer = undefined;
    }
  }

  private handleFollowUpSubmit(): boolean {
    const text = this.input.value.trim();
    if (!text || this.runtime.state() === 'idle') return false;

    this.input.setValue('');
    this.clearToast();
    this.updateCommandPalette('');
    this.setStatus('queued follow-up');
    const message: Message = { role: 'user', content: text };
    this.transcript.appendVisibleQueuedMessage(message, 'follow_up');
    this.updateWaitingList();
    this.renderTranscript();
    this.bus.publish({ type: 'follow_up', message });
    this.tui.requestRender();
    return true;
  }

  private pushHistory(text: string): void {
    this.history.push(text, this.input.value);
  }

  private navigateHistory(direction: 'up' | 'down'): boolean {
    const result = this.history.navigate(this.input.value, direction);
    if (!result) return false;
    this.history.withNavigation(() => {
      this.input.setValue(result.text);
      this.updateInputHeight(result.text);
    });
    this.tui.requestRender();
    return true;
  }

  private updateInputHeight(value: string): void {
    const inputLines = Math.min(7, Math.max(1, value.split('\n').length));
    this.input.layout.height = inputLines;
    if (this.inputRow.layout) this.inputRow.layout.height = inputLines;
    const inputBoxHeight = 1 + inputLines + 1 + 1 + 1;
    if (this.inputBox.layout) this.inputBox.layout.height = inputBoxHeight;
    this.history.resetIfStale();
    this.updateBashMode(value);
    this.updateCommandPalette(value);
    this.updateFilePicker();
    this.updateHighlights(value);
    this.updateDockHeight();
  }

  private updateDockHeight(): void {
    const inputBoxHeight = (this.inputBox.layout?.height as number) ?? 4;
    const topZoneHeight = (this.inputTopWidgetZone.layout?.height as number) ?? 0;
    const bottomZoneHeight = (this.inputBottomWidgetZone.layout?.height as number) ?? 0;
    const toastHeight = (this.toastZone.layout?.height as number) ?? 0;
    const statusHeight = 1;
    if (this.bottomDock.layout) {
      this.bottomDock.layout.height = toastHeight + topZoneHeight + inputBoxHeight + bottomZoneHeight + statusHeight;
    }
  }

  private updateBashMode(value: string): void {
    const bashMode = value.startsWith('!') || value.startsWith('$');
    if (bashMode === this.bashMode) return;
    this.bashMode = bashMode;
    this.inputRow.children = bashMode ? [this.bashPrompt, this.input] : [this.defaultPrompt, this.input];
    if (bashMode) this.input.hiddenPrefix = value[0]!;
    this.tui.requestRender();
  }

  private interceptInput(event: InputEvent): boolean {
    if (this.modelPicker.isOpen && event.type === 'key' && event.kind !== 'release') {
      return this.modelPicker.handleKey(event);
    }

    // Sub-agent screen is read-only: only Esc (return to main) reaches us;
    // every other key is swallowed before the input or any shortcut sees it.
    // Mouse and paste events fall through so scroll / click can still work.
    if (this.subAgents.viewing && event.type === 'key' && event.kind !== 'release') {
      if (event.key === 'escape' || event.key === 'esc') {
        this.subAgents.closeDetail();
      }
      return true;
    }

    if (event.type === 'key' && event.kind !== 'release' && (event.key === 'escape' || event.key === 'esc')) {
      if (this.clearToast()) return true;
      if (this.filePicker.visible) return false;
      if (this.input.value.startsWith('!') || this.input.value.startsWith('$') || this.input.value.startsWith('/')) {
        this.input.setValue('');
        this.updateInputHeight('');
        this.tui.requestRender();
        return true;
      }
      if (this.runtime.state() === 'running') {
        const now = Date.now();
        const elapsed = now - this.lastEscTime;
        if (this.lastEscTime > 0 && elapsed < 1500) {
          this.lastEscTime = 0;
          void this.cancelGeneration();
        } else {
          this.lastEscTime = now;
          this.setStatus('press Esc again to cancel');
        }
        return true;
      }
    }

    if (event.type === 'key' && event.kind !== 'release' && event.key === 'backspace') {
      if (this.deleteAtToken()) return true;
    }

    if (event.type === 'key' && event.kind !== 'release' && event.key === 'enter' && event.alt) {
      return this.handleFollowUpSubmit();
    }

    if (event.type === 'key' && event.kind !== 'release' && this.filePicker.visible && !this.commandPalette) {
      if (this.filePicker.intercept(event)) return true;
    }

    if (event.type === 'key' && event.kind !== 'release' && !this.commandPalette && !this.filePicker.visible) {
      if (event.key === 'up') return this.navigateHistory('up');
      if (event.key === 'down') return this.navigateHistory('down');
      if (event.key === 'tab' && this.canCyclePrimaryAgent()) {
        this.cyclePrimaryAgent(event.shift ? -1 : 1);
        return true;
      }
    }

    if (!this.commandPalette || event.type !== 'key' || event.kind === 'release') return false;

    if (event.key === 'up') {
      this.commandCursor = Math.max(0, this.commandCursor - 1);
      this.updateCommandPalette(this.input.value);
      return true;
    }
    if (event.key === 'down') {
      this.commandCursor = Math.min(
        Math.max(0, Math.min(6, this.filteredCommands(this.input.value).length) - 1),
        this.commandCursor + 1,
      );
      this.updateCommandPalette(this.input.value);
      return true;
    }
    if (event.key === 'tab') {
      this.completeSelectedCommand();
      return true;
    }
    if (event.key === 'enter') {
      this.runSelectedCommand();
      return true;
    }
    if (event.key === 'escape' || event.key === 'esc') {
      this.dismissedPaletteFor = this.input.value;
      this.updateCommandPalette(this.input.value);
      return true;
    }

    return false;
  }

  // --- Commands ---

  private executeCommand(command: ChatCommand, args: string): void {
    if (command.deferWhenBusy && this.runtime.state() !== 'idle') {
      const label = args ? `/${command.name} ${args}` : `/${command.name}`;
      this.deferredCommandQueue.push({ label, run: () => void command.run(args, undefined) });
      return;
    }
    void command.run(args, undefined);
  }

  private collectWaitingItems(): WaitingItem[] {
    const items: WaitingItem[] = [];
    for (const entry of this.transcript.visibleQueuedLines) {
      items.push({ kind: entry.queue, text: entry.line.content });
    }
    for (const entry of this.deferredCommandQueue.snapshot()) {
      items.push({ kind: 'command', text: entry.label });
    }
    return items;
  }

  private updateWaitingList(): void {
    const items = this.collectWaitingItems();
    if (items.length === 0) {
      this.waitingList = undefined;
      this.inputBottomWidgetZone.children = [];
      if (this.inputBottomWidgetZone.layout) this.inputBottomWidgetZone.layout.height = 0;
      this.updateDockHeight();
      this.tui.requestRender();
      return;
    }
    const height = Math.min(items.length, 6);
    if (this.waitingList) {
      this.waitingList.setItems(items);
    } else {
      this.waitingList = new WaitingList({ items, layout: { width: 'fill', height } });
      this.inputBottomWidgetZone.children = [this.waitingList];
    }
    if (this.inputBottomWidgetZone.layout) this.inputBottomWidgetZone.layout.height = height;
    this.updateDockHeight();
    this.tui.requestRender();
  }

  private filteredCommands(value: string): ChatCommand[] {
    return filterCommands(this.commands, value, this.dismissedPaletteFor);
  }

  private updateCommandPalette(value: string): void {
    if (value !== this.dismissedPaletteFor) this.dismissedPaletteFor = '';
    const items = this.filteredCommands(value);
    this.commandCursor = Math.max(0, Math.min(this.commandCursor, Math.max(0, Math.min(6, items.length) - 1)));

    if (items.length === 0) {
      this.commandPalette = undefined;
      this.inputTopWidgetZone.children = [];
      if (this.inputTopWidgetZone.layout) this.inputTopWidgetZone.layout.height = 0;
      this.updatePromptForPalette(false);
      this.updateDockHeight();
      return;
    }

    const visibleItems = items.slice(0, 6);
    this.commandPalette = new CommandPalette({
      items: visibleItems,
      selectedIndex: this.commandCursor,
      onSelect: (index: number) => {
        this.commandCursor = index;
        const command = this.filteredCommands(this.input.value)[index];
        if (command) {
          this.input.setValue('');
          this.updateCommandPalette('');
          this.executeCommand(command, '');
        }
      },
      layout: { width: 'fill', height: visibleItems.length },
    });
    this.inputTopWidgetZone.children = [this.commandPalette];
    if (this.inputTopWidgetZone.layout) this.inputTopWidgetZone.layout.height = visibleItems.length;
    this.updatePromptForPalette(true);
    this.updateDockHeight();
  }

  private updatePromptForPalette(open: boolean): void {
    if (this.bashMode) return;
    const theme = this.themeProvider.current();
    const prefix = styleToAnsi(theme.styles.muted);
    this.defaultPrompt.setText(open ? `${prefix}/\x1b[0m` : `${prefix}❯\x1b[0m`);
    this.input.hiddenPrefix = open ? '/' : '!';
  }

  private completeSelectedCommand(): void {
    const command = this.filteredCommands(this.input.value)[this.commandCursor];
    if (!command) return;
    const next = `/${command.name} `;
    this.input.setValue(next);
    this.input.setCursor(next.length);
    this.updateCommandPalette(next);
  }

  private runSelectedCommand(): void {
    const command = this.filteredCommands(this.input.value)[this.commandCursor];
    if (!command) return;
    this.input.setValue('');
    this.updateCommandPalette('');
    this.executeCommand(command, '');
  }

  private runCommand(value: string): boolean {
    if (value.startsWith('!') || value.startsWith('$')) {
      runShellCommand({
        cmd: value.slice(1).trim(),
        transcript: this.transcript,
        theme: this.themeProvider.current(),
        onRender: () => this.renderTranscript(),
      });
      return true;
    }
    if (!value.trim().startsWith('/')) return false;
    const match = this.commands.match(value);
    if (!match) {
      const name = value.trim().slice(1).split(/\s+/)[0] ?? '';
      this.transcript.lines.push({ role: 'error', content: `Unknown command: /${name}` });
      this.renderTranscript();
      return true;
    }
    this.executeCommand(match.command, match.args);
    return true;
  }

  // --- File Picker ---

  /** Mount or unmount a widget in the zone above the input. */
  private mountTopWidget(component: Component | undefined, height: number): void {
    if (component) {
      this.inputTopWidgetZone.children = [component];
    } else if (!this.commandPalette) {
      this.inputTopWidgetZone.children = [];
    }
    if (this.inputTopWidgetZone.layout) this.inputTopWidgetZone.layout.height = height;
    this.updateDockHeight();
  }

  private updateFilePicker(): void {
    if (this.commandPalette) {
      this.filePicker.dismiss();
      return;
    }
    this.filePicker.update();
  }

  private updateHighlights(value: string): void {
    const highlights: InputHighlight[] = [];
    const theme = this.themeProvider.current();
    const atStyle = styleToAnsi({ fg: theme.colors.warning, bold: true });
    const re = /@[^\s]+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      highlights.push({ start: match.index, end: match.index + match[0].length, style: atStyle });
    }
    this.input.highlights = highlights;
  }

  private deleteAtToken(): boolean {
    const value = this.input.value;
    const cursor = this.input.cursor;
    const re = /@[^\s]+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (cursor > start && cursor <= end) {
        const newValue = value.slice(0, start) + value.slice(end);
        this.input.setValue(newValue);
        this.input.setCursor(start);
        this.updateHighlights(newValue);
        this.tui.requestRender();
        return true;
      }
    }
    return false;
  }

  // Note: mu-core Runtime exposes no AbortSignal, so we cannot interrupt an
  // in-flight provider stream. We fire-and-forget the stop() and rebuild the
  // runtime so the UI proceeds immediately; the provider may continue to drain
  // in the background until its stream completes.
  private async cancelGeneration(): Promise<void> {
    if (!this.modelController) return;
    this.setStatus('cancelling...');
    this.tui.requestRender();
    void this.runtime.stop();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.runtime = this.modelController.createRuntime();
    this.unsubscribe = this.bus.subscribe((event) => this.handleEvent(event));
    await this.runtime.start();
    this.transcript.visibleQueuedLines.length = 0;
    this.transcript.resetPending();
    this.updateWaitingList();
    this.stopSpinner();
    this.setStatus('cancelled');
    this.tui.requestRender();
    this.deferredCommandQueue.scheduleDrain();
  }

  // --- Session commands ---

  private async startNewSession(): Promise<void> {
    if (!this.modelController) {
      this.showErrorToast('No runtime controller is configured.');
      return;
    }
    if (this.runtime.state() !== 'idle') {
      this.showErrorToast('Cannot start a new session while a response is running.');
      return;
    }

    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.subAgents.detachViewing();
    await this.runtime.stop();
    this.runtime = this.modelController.createRuntime();
    this.unsubscribe = this.bus.subscribe((event) => this.handleEvent(event));
    await this.runtime.start();
    this.transcript.reset();
    this.subAgents.previews.clear();
    this.deferredCommandQueue.clear();
    this.contextText = '';
    this.roundtrips.clear();
    this.setStatus('new session');
    this.updateWaitingList();
    this.renderTranscript();
  }

  private async exportContext(args: string): Promise<void> {
    await exportContextToFile({
      args,
      roundtrips: this.roundtrips,
      modelId: this.modelController?.model,
      transcript: this.transcript,
      onRender: () => this.renderTranscript(),
      onError: (message) => this.showErrorToast(message),
    });
  }

  private handleToggleThinking(): void {
    this.transcript.toggleThinking();
    this.options.onThinkingVisibleChange?.(this.transcript.thinkingVisible);
    this.renderTranscript();
  }

  private toggleOutputBlocks(): void {
    if (toggleOutputBlocksInTranscript(this.transcript)) this.renderTranscript();
  }

  // --- Model picker modal ---

  private openModelModal(): void {
    this.modelPicker.open();
  }

  /**
   * Add/remove a modal at the root level. `ModelPickerController` is the only
   * caller today; if more modal-bearing controllers appear they reuse the same
   * mount point, which is why this stays generic.
   */
  private mountRootModal(modal: Component | undefined): void {
    if (this.mountedModal) this.root.removeChild(this.mountedModal);
    this.mountedModal = modal ?? undefined;
    if (modal) this.root.addChild(modal);
  }

  // --- Event handling ---

  private handleEvent(event: CoreEvent): void {
    // Generic shared behavior — appending to transcript, activating queued
    // user lines on turn-start, status labels — comes from harness.
    this.transcript.apply(event);
    const status = statusFromEvent(event);
    if (status !== undefined) this.setStatus(status);

    // Agent-specific side effects.
    switch (event.type) {
      case 'context_update':
        this.setContext(event.context);
        break;
      case 'queued_message':
        this.updateWaitingList();
        break;
      case 'error': {
        const msg = event.error instanceof Error ? event.error.message : String(event.error);
        this.showErrorToast(msg);
        break;
      }
    }
    this.renderTranscript();
    this.deferredCommandQueue.scheduleDrain();
  }

  // --- Rendering ---

  private renderTranscript(): void {
    const shouldStickToBottom = this.scrollView.isAtBottom();
    let components: Component[];
    if (this.subAgents.viewing) {
      const run = this.subAgents.runs.get(this.subAgents.viewing);
      if (!run) {
        // The run vanished — fall back to the main view.
        this.subAgents.detachViewing();
        components = this.buildMainComponents();
      } else {
        components = buildSubAgentViewComponents(run);
      }
    } else {
      components = this.buildMainComponents();
    }
    this.scrollView.setChildren(components, { stickToBottom: shouldStickToBottom });
    this.tui.requestRender();
  }

  private buildMainComponents(): Component[] {
    return buildTranscriptComponents({
      transcript: this.transcript,
      subAgentRuns: this.subAgents.runs,
      previewCache: this.subAgents.previews,
      onOpenSubAgent: (id) => this.subAgents.openDetail(id),
      onOpenThinking: (line) => {
        this.transcript.openThinkingLine(line);
        this.renderTranscript();
      },
    });
  }
}
