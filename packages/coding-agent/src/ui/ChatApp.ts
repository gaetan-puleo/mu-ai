import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import type { CoreEvent, LLMResponseContext, Message, Runtime, Unsubscribe } from 'mu-core';
import type { LocalModel } from 'mu-local-provider';
import { type Component, type InputEvent, ProcessTerminal, TUI } from 'mu-tui';
import { Box, Input, Modal, ScrollView, SelectList } from 'mu-tui/components';
import { AssistantMessage } from './components/AssistantMessage';
import { CommandLine } from './components/CommandLine';
import { CommandPalette, type CommandPaletteItem } from './components/CommandPalette';
import { CommandResultLine } from './components/CommandResultLine';
import { OutputBlock } from './components/OutputBlock';
import { ContextMap } from './components/ContextMap';
import { ErrorLine } from './components/ErrorLine';
import { ErrorToast } from './components/ErrorToast';
import { HiddenThinkingLine } from './components/HiddenThinkingLine';
import { ReasoningBlock } from './components/ReasoningBlock';
import { formatToolCallArgs, ToolLine } from './components/ToolLine';
import { UserMessage } from './components/UserMessage';
import { StatusLine } from './statusLine';
import { STATUS_SLOTS, type StatusSlotContext } from './statusSlots';
import { darkTheme, getTheme, lightTheme, styleToAnsi, type Theme, ThemeProvider } from './theme';

type ChatLine =
  | { role: 'user'; content: string; label?: 'queued steering' | 'follow-up' }
  | { role: 'assistant' | 'error'; content: string }
  | { role: 'command'; content: string }
  | { role: 'command_result'; content: string }
  | { role: 'output_block'; component: OutputBlock }
  | { role: 'context'; context?: unknown }
  | { role: 'reasoning'; content: string; closed?: boolean }
  | { role: 'tool'; callId: string; name: string; argsPreview: string };

type UserChatLine = Extract<ChatLine, { role: 'user' }>;

interface VisibleQueuedLine {
  message: Message;
  queue: 'steering' | 'follow_up';
  line: UserChatLine;
}

interface ChatBus {
  publish: (event: CoreEvent) => void;
  subscribe: (fn: (event: CoreEvent) => void) => Unsubscribe;
}

interface ChatCommand extends CommandPaletteItem {
  run: (args: string) => void;
}

interface ModelController {
  createRuntime: () => Runtime;
  listModels: () => Promise<LocalModel[]>;
  getModel: () => string;
  setModel: (model: string) => void;
}

interface ChatAppOptions {
  thinkingVisible?: boolean;
  onThinkingVisibleChange?: (visible: boolean) => void;
}

type ModalMode = 'model';

type ChatEvent = CoreEvent | { type: 'context_update'; context: LLMResponseContext };

const SPINNER_INTERVAL_MS = 100;

export class ChatApp {
  private tui: TUI;
  private terminal: ProcessTerminal;
  private runtime: Runtime;
  private bus: ChatBus;
  private transcript: ChatLine[] = [];
  private scrollView: ScrollView;
  private transcriptBox: Box;
  private root: Box;
  private input: Input;
  private inputBox: Box;
  private bottomDock: Box;
  private statusText: StatusLine;
  private statusBox: Box;
  private toastZone: Box;
  private inputTopWidgetZone: Box;
  private inputBottomWidgetZone: Box;
  private commandPalette: CommandPalette | undefined;
  private commandItems: ChatCommand[] = [];
  private commandCursor = 0;
  private dismissedPaletteFor = '';
  private modal: Modal | undefined;
  private modalMode: ModalMode | undefined;
  private models: LocalModel[] = [];
  private modelCursor = 0;
  private unsubscribe: Unsubscribe | undefined;
  private stopped = false;
  private status = 'ready';
  private contextText = '';
  private latestContext: LLMResponseContext | undefined;
  private thinkingVisible = true;
  private queuedUserLines: UserChatLine[] = [];
  private visibleQueuedLines: VisibleQueuedLine[] = [];
  private themeProvider: ThemeProvider;
  private unsubscribeTheme: (() => void) | undefined;
  private unsubscribeStatusSlots: (() => void) | undefined;
  private unregisterStatusSlotContributors: Array<() => void> = [];
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private spinnerTick = 0;

  private pendingAssistantIndex: number | undefined;
  private pendingReasoningIndex: number | undefined;

  constructor(
    runtime: Runtime,
    bus: ChatBus,
    private readonly modelController?: ModelController,
    private readonly onExit?: (code: number) => void,
    private readonly options: ChatAppOptions = {},
  ) {
    this.runtime = runtime;
    this.bus = bus;
    this.models = [];
    this.thinkingVisible = options.thinkingVisible ?? true;

    this.themeProvider = new ThemeProvider(darkTheme);
    const theme = this.themeProvider.current();

    this.terminal = new ProcessTerminal({ keyboard: true, mouse: { drag: true, motion: true } });
    this.tui = new TUI(this.terminal, { userContext: this.themeProvider });

    this.scrollView = new ScrollView({
      layout: { width: 'fill', height: 'fill' },
      focusable: false,
    });

    this.transcriptBox = new Box({
      layout: { width: 'fill', height: 'fill', overflow: 'hidden' },
      children: [this.scrollView],
    });

    this.statusText = new StatusLine();
    this.statusBox = new Box({
      layout: { width: 'fill', height: 1, zIndex: 10 },
      children: [this.statusText],
    });

    this.toastZone = new Box({
      layout: { width: 'fill', height: 0, zIndex: 20 },
      children: [],
    });

    this.input = new Input({
      placeholder: 'type a message...',
      placeholderStyle: styleToAnsi(theme.styles.muted),
      textStyle: styleToAnsi(theme.styles.body),
      onChange: (value: string) => this.updateInputHeight(value),
      onSubmit: (value: string) => this.handleSubmit(value),
      layout: { width: 'fill', height: 1, zIndex: 10 },
    });

    this.inputTopWidgetZone = new Box({
      layout: { width: 'fill', height: 0, zIndex: 10 },
      children: [],
    });

    this.inputBottomWidgetZone = new Box({
      layout: { width: 'fill', height: 0, zIndex: 10 },
      children: [],
    });

    this.inputBox = new Box({
      layout: {
        width: 'fill',
        height: 3,
        direction: 'row',
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
        backgroundColor: theme.colors.surface,
        zIndex: 10,
      },
      children: [this.input],
    });

    this.bottomDock = new Box({
      layout: {
        width: 'fill',
        height: 'auto',
        direction: 'column',
        margin: { top: 1 },
        zIndex: 10,
      },
      children: [this.toastZone, this.inputBox, this.inputBottomWidgetZone, this.statusBox],
    });

    this.commandItems = this.createCommands();

    this.root = new Box({
      layout: {
        width: 'fill',
        height: 'fill',
        direction: 'column',
        padding: { left: 1, right: 1 },
        backgroundColor: theme.colors.background,
      },
      children: [this.transcriptBox, this.inputTopWidgetZone, this.bottomDock],
    });

    this.tui.addChild(this.root);
    this.tui.setFocus(this.input);
    this.tui.addInputInterceptor((event) => this.interceptInput(event));
    this.registerGlobalKeybindings();

    this.finishInitialization();
  }

  private finishInitialization(): void {
    this.unsubscribeTheme = this.themeProvider.subscribe((next) => this.applyTheme(next));
    this.registerStatusSlots();
    this.updateStatusLine();
  }

  private registerStatusSlots(): void {
    this.unregisterStatusSlotContributors.push(
      STATUS_SLOTS.register('status.left', ({ model }) => model),
      STATUS_SLOTS.register('status.right', ({ contextText }) => contextText),
    );
    this.unsubscribeStatusSlots = STATUS_SLOTS.subscribe(() => {
      this.updateStatusLine();
      this.tui.requestRender();
    });
  }

  private registerGlobalKeybindings(): void {
    this.tui.addGlobalKeybinding({
      chord: { key: 'c', ctrl: true },
      handler: () => this.handleCtrlC(),
    });
    this.tui.addGlobalKeybinding({
      chord: { key: 't', ctrl: true },
      handler: () => this.toggleTheme(),
    });
  }

  /**
   * Apply a theme: rebuild theme-derived layout styles (background colors,
   * input SGR strings) and trigger a full redraw via `setUserContext`. The
   * transcript is also re-rendered so per-message components capture the new
   * surface color into their `LayoutStyle.backgroundColor`.
   */
  private applyTheme(theme: Theme): void {
    if (this.root.layout) this.root.layout.backgroundColor = theme.colors.background;
    if (this.inputBox.layout) this.inputBox.layout.backgroundColor = theme.colors.surface;
    this.input.placeholderStyle = styleToAnsi(theme.styles.muted);
    this.input.textStyle = styleToAnsi(theme.styles.body);
    this.renderTranscript();
    this.tui.setUserContext(this.themeProvider);
  }

  private toggleTheme(): void {
    const next = this.themeProvider.current().name === 'dark' ? lightTheme : darkTheme;
    this.themeProvider.setTheme(next);
  }

  start(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.handleEvent(event));
    this.runtime.start();
    this.tui.start();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = undefined;
    this.unsubscribeStatusSlots?.();
    this.unsubscribeStatusSlots = undefined;
    for (const unregister of this.unregisterStatusSlotContributors.splice(0)) unregister();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = undefined;
    this.stopSpinner();
    this.runtime.stop();
    this.tui.stop();
  }

  private handleCtrlC(): void {
    if (this.input.value.length > 0) {
      this.input.setValue('');
      this.tui.requestRender();
      return;
    }

    this.stop();
    this.onExit?.(130);
  }

  private handleSubmit(value: string): void {
    const text = value.trim();
    if (!text) return;

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
      this.transcript.push({ role: 'user', content: text });
    }
    this.setStatus('thinking...');

    const message: Message = { role: 'user', content: text };
    if (isSteering) {
      this.appendVisibleQueuedMessage(message, 'steering');
    }
    this.renderTranscript();
    this.bus.publish({ type: isSteering ? 'steer' : 'user_message', message });
  }

  private updateInputHeight(value: string): void {
    const lines = Math.min(7, Math.max(1, value.split('\n').length));
    this.input.layout.height = lines;
    if (this.inputBox.layout) this.inputBox.layout.height = lines + 2;
    this.updateCommandPalette(value);
  }

  private interceptInput(event: InputEvent): boolean {
    if (this.modal && event.type === 'key' && event.kind !== 'release') {
      return this.interceptModalInput(event);
    }

    if (event.type === 'key' && event.kind !== 'release' && (event.key === 'escape' || event.key === 'esc')) {
      if (this.clearToast()) return true;
    }

    if (event.type === 'key' && event.kind !== 'release' && event.key === 'enter' && event.alt) {
      return this.handleFollowUpSubmit();
    }

    if (!this.commandPalette || event.type !== 'key' || event.kind === 'release') return false;

    if (event.key === 'up') {
      this.commandCursor = Math.max(0, this.commandCursor - 1);
      this.updateCommandPalette(this.input.value);
      return true;
    }
    if (event.key === 'down') {
      this.commandCursor = Math.min(
        Math.min(6, this.filteredCommands(this.input.value).length) - 1,
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

  private interceptModalInput(event: Extract<InputEvent, { type: 'key' }>): boolean {
    if (this.modalMode === 'model') {
      return this.interceptModelModal(event);
    }

    if (event.key === 'escape' || event.key === 'esc' || event.key === 'enter') {
      this.closeModal();
      return true;
    }

    return false;
  }

  private handleFollowUpSubmit(): boolean {
    const text = this.input.value.trim();
    if (!text || this.runtime.state() === 'idle') {
      return false;
    }

    this.input.setValue('');
    this.clearToast();
    this.updateCommandPalette('');
    this.setStatus('queued follow-up');
    const message: Message = { role: 'user', content: text };
    this.appendVisibleQueuedMessage(message, 'follow_up');
    this.renderTranscript();
    this.bus.publish({ type: 'follow_up', message });
    this.tui.requestRender();
    return true;
  }

  private createCommands(): ChatCommand[] {
    return [
      {
        name: 'new',
        description: 'start a new session',
        run: () => this.startNewSession(),
      },
      {
        name: 'model',
        description: 'switch the active model',
        run: () => this.openModelModal(),
      },
      {
        name: 'context',
        description: 'show context map',
        run: () => this.showContextMap(),
      },
      {
        name: 'context-export',
        description: 'export context map to a file',
        run: (args) => void this.exportContext(args),
      },
      {
        name: 'thinking',
        description: 'toggle thinking blocks',
        run: () => this.toggleThinking(),
      },
      {
        name: 'quit',
        description: 'exit the agent',
        run: () => {
          this.stop();
          this.onExit?.(0);
        },
      },
    ];
  }

  private startNewSession(): void {
    if (!this.modelController) {
      this.showErrorToast('No runtime controller is configured.');
      return;
    }

    if (this.runtime.state() !== 'idle') {
      this.showErrorToast('Cannot start a new session while a response is running.');
      return;
    }

    this.runtime.stop();
    this.runtime = this.modelController.createRuntime();
    this.runtime.start();
    this.transcript = [];
    this.queuedUserLines = [];
    this.visibleQueuedLines = [];
    this.pendingAssistantIndex = undefined;
    this.pendingReasoningIndex = undefined;
    this.contextText = '';
    this.latestContext = undefined;
    this.setStatus('new session');
    this.renderTranscript();
  }

  private showContextMap(): void {
    this.transcript.push({ role: 'command', content: '/context' });
    this.transcript.push({ role: 'context', context: this.latestContext });
    this.renderTranscript();
  }

  private async exportContext(args: string): Promise<void> {
    if (!this.latestContext) {
      this.showErrorToast('No context available to export.');
      return;
    }

    const outputPath = args.trim() || '.mu/context.json';
    const resolvedPath = resolve(outputPath);
    const payload = {
      exportedAt: new Date().toISOString(),
      model: this.modelController?.getModel(),
      context: this.latestContext,
    };

    try {
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      this.transcript.push({ role: 'command', content: `/context-export ${outputPath}` });
      this.transcript.push({ role: 'command_result', content: `saved context to ${outputPath}` });
      this.renderTranscript();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showErrorToast(`Failed to export context: ${message}`);
    }
  }

  private filteredCommands(value: string): ChatCommand[] {
    if (!value.startsWith('/') || value.includes(' ') || value === this.dismissedPaletteFor) return [];
    const query = value.slice(1).toLowerCase();
    return this.commandItems.filter((command) => command.name.toLowerCase().startsWith(query));
  }

  private toggleThinking(): void {
    this.thinkingVisible = !this.thinkingVisible;
    for (const entry of this.transcript) {
      if (entry.role === 'reasoning') entry.closed = !this.thinkingVisible;
    }
    this.options.onThinkingVisibleChange?.(this.thinkingVisible);
    this.renderTranscript();
  }

  private openThinkingLine(line: Extract<ChatLine, { role: 'reasoning' }>): void {
    if (!line.closed) return;
    line.closed = false;
    this.renderTranscript();
  }

  private updateCommandPalette(value: string): void {
    if (value !== this.dismissedPaletteFor) this.dismissedPaletteFor = '';
    const items = this.filteredCommands(value);
    this.commandCursor = Math.max(0, Math.min(this.commandCursor, Math.max(0, Math.min(6, items.length) - 1)));

    if (items.length === 0) {
      this.commandPalette = undefined;
      this.inputTopWidgetZone.children = [];
      if (this.inputTopWidgetZone.layout) this.inputTopWidgetZone.layout.height = 0;
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
          command.run('');
        }
      },
      layout: { width: 'fill', height: visibleItems.length },
    });
    this.inputTopWidgetZone.children = [this.commandPalette];
    if (this.inputTopWidgetZone.layout) this.inputTopWidgetZone.layout.height = visibleItems.length;
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
    command.run('');
  }

  private runCommand(value: string): boolean {
    if (value.startsWith('!')) {
      this.runShellCommand(value.slice(1));
      return true;
    }

    if (!value.startsWith('/')) return false;
    const [rawName, ...rest] = value.slice(1).split(/\s+/);
    const command = this.commandItems.find((item) => item.name === rawName);
    if (!command) {
      this.transcript.push({ role: 'error', content: `Unknown command: /${rawName}` });
      this.renderTranscript();
      return true;
    }
    command.run(rest.join(' '));
    return true;
  }

  private runShellCommand(cmd: string): void {
    const theme = this.themeProvider.current();
    const outputBlock = new OutputBlock({
      command: cmd,
      output: '',
      theme,
    });

    this.transcript.push({ role: 'output_block', component: outputBlock });
    this.renderTranscript();

    let stdout = '';
    let stderr = '';
    const proc = spawn('bash', ['-c', cmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString('utf-8'); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString('utf-8'); });

    proc.on('close', (code) => {
      const output = code !== 0 || stderr ? [stdout, stderr].filter(Boolean).join('\n') : stdout;
      outputBlock.props.output = output.trim() || '(no output)';
      this.renderTranscript();
    });

    proc.on('error', (err) => {
      outputBlock.props.output = err.message;
      this.renderTranscript();
    });
  }

  private openModelModal(): void {
    if (!this.modelController) {
      this.openModal('model', {
        title: 'Model Picker',
        body: 'No model controller is configured.',
        footer: 'Esc or Enter to close',
        onClose: () => this.closeModal(),
      });
      return;
    }

    if (this.runtime.state() !== 'idle') {
      this.openModal('model', {
        title: 'Model Picker',
        body: 'Cannot switch model while a response is running.',
        footer: 'Esc or Enter to close',
        onClose: () => this.closeModal(),
      });
      return;
    }

    this.openModal('model', {
      title: 'Model Picker',
      body: `Loading models...\nCurrent: ${this.modelController.getModel() || 'unknown'}`,
      footer: 'Up/Down to move, Enter to select, Esc to close',
      onClose: () => this.closeModal(),
    });

    void this.loadModelsForModal();
  }

  private async loadModelsForModal(): Promise<void> {
    if (!(this.modelController && this.modal) || this.modalMode !== 'model') return;
    try {
      this.models = await this.modelController.listModels();
      const current = this.modelController.getModel();
      this.modelCursor = Math.max(
        0,
        this.models.findIndex((model) => model.id === current),
      );
      this.mountModelSelectList();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.modal.setContent({
        title: 'Model Picker',
        body: `Failed to list models:\n${message}`,
        footer: 'Esc or Enter to close',
        content: undefined,
      });
      this.tui.requestRender(true);
    }
  }

  private mountModelSelectList(): void {
    if (!this.modal || this.modalMode !== 'model') return;
    const current = this.modelController?.getModel() ?? '';

    if (this.models.length === 0) {
      this.modal.setContent({
        title: 'Model Picker',
        body: 'No models available.',
        footer: 'Esc to close',
        content: undefined,
      });
      this.tui.requestRender(true);
      return;
    }

    const items = this.models.map((model) => {
      const active = model.id === current ? '*' : ' ';
      const desc = model.description ? ` - ${model.description}` : '';
      return { label: `${active} ${model.id}${desc}`, value: model };
    });

    const selectList = new SelectList<LocalModel>({
      items,
      selectedIndex: this.modelCursor,
      onChange: (_item, index) => {
        this.modelCursor = index;
      },
      onSelect: (item) => {
        if (item.value) this.selectModelById(item.value.id);
      },
      layout: { width: 'fill', height: 'fill' },
      // Pull explicit fg+bg pairs from the active theme so the picker stays
      // readable under both dark and light themes (and matches the command
      // palette styling).
      resolveStyles: (ctx) => {
        const theme = getTheme(ctx);
        return {
          item: styleToAnsi(theme.styles.commandPaletteItem),
          selected: styleToAnsi(theme.styles.commandPaletteSelected),
          hovered: styleToAnsi(theme.styles.commandPaletteHover),
        };
      },
    });

    // Compact panel sized to fit the visible items (cap at 10) plus 2 rows
    // for title + footer.
    const visibleRows = Math.min(items.length, 10);
    this.modal.setSize(undefined, visibleRows + 2);

    this.modal.setContent({
      title: 'Model Picker',
      footer: `Current: ${current || 'unknown'} | Up/Down, Enter, Esc | click a row`,
      content: selectList,
    });
    this.tui.setFocus(selectList);
    this.tui.requestRender(true);
  }

  private interceptModelModal(event: Extract<InputEvent, { type: 'key' }>): boolean {
    if (event.key === 'escape' || event.key === 'esc') {
      this.closeModal();
      return true;
    }
    // Let SelectList (focused) handle up/down/enter natively.
    return false;
  }

  private selectModelById(id: string): void {
    if (!this.modelController) {
      this.closeModal();
      return;
    }
    this.modelController.setModel(id);
    this.setStatus(`model: ${id}`);
    this.closeModal();
  }

  private openModal(mode: ModalMode, props: ConstructorParameters<typeof Modal>[0]): void {
    if (this.modal) this.root.removeChild(this.modal);
    this.modalMode = mode;
    this.modal = new Modal(props);
    this.root.addChild(this.modal);
    this.tui.setFocus(this.modal);
    this.tui.requestRender(true);
  }

  private closeModal(): void {
    if (!this.modal) return;
    this.root.removeChild(this.modal);
    this.modal = undefined;
    this.modalMode = undefined;
    this.tui.setFocus(this.input);
    this.tui.requestRender(true);
  }

  private handleEvent(event: ChatEvent): void {
    switch (event.type) {
      case 'assistant_start':
        this.activateNextQueuedUserMessage();
        this.setStatus('streaming...');
        break;
      case 'assistant_delta':
        this.activateNextQueuedUserMessage();
        this.appendAssistantDelta(event.content);
        this.setStatus('streaming...');
        break;
      case 'assistant_message':
        this.activateNextQueuedUserMessage();
        this.appendAssistantMessage(event.message);
        this.setStatus('ready');
        break;
      case 'reasoning_delta':
        this.activateNextQueuedUserMessage();
        this.appendReasoningDelta(event.content);
        this.setStatus('reasoning...');
        break;
      case 'reasoning_message':
        this.activateNextQueuedUserMessage();
        this.appendReasoningMessage(event.message);
        this.setStatus('reasoning...');
        break;
      case 'tool_call':
        this.activateNextQueuedUserMessage();
        this.appendToolCall(event.call);
        this.setStatus(`tool: ${event.call.tool}`);
        break;
      case 'tool_result':
        this.setStatus('ready');
        break;
      case 'context_update':
        this.setContext(event.context);
        break;
      case 'queued_message':
        this.appendQueuedMessage(event.message, event.queue);
        break;
      case 'queue_update':
        break;
      case 'error':
        this.appendError(event.error);
        break;
    }
    this.renderTranscript();
  }

  private appendAssistantDelta(content: string): void {
    if (this.pendingAssistantIndex === undefined) {
      this.transcript.push({ role: 'assistant', content: '' });
      this.pendingAssistantIndex = this.transcript.length - 1;
    }
    const pending = this.transcript[this.pendingAssistantIndex];
    if (pending?.role === 'assistant') pending.content += content;
  }

  private appendQueuedMessage(message: Message, queue: 'steering' | 'follow_up'): void {
    const visibleIndex = this.visibleQueuedLines.findIndex((entry) => entry.message === message);
    const line =
      visibleIndex === -1
        ? this.createQueuedUserLine(message, queue)
        : this.visibleQueuedLines.splice(visibleIndex, 1)[0].line;

    this.transcript.push(line);
    this.queuedUserLines.push(line);
  }

  private appendVisibleQueuedMessage(message: Message, queue: 'steering' | 'follow_up'): void {
    if (this.visibleQueuedLines.some((entry) => entry.message === message)) return;
    this.visibleQueuedLines.push({ message, queue, line: this.createQueuedUserLine(message, queue) });
  }

  private createQueuedUserLine(message: Message, queue: 'steering' | 'follow_up'): UserChatLine {
    return {
      role: 'user',
      content: message.content,
      label: queue === 'steering' ? 'queued steering' : 'follow-up',
    };
  }

  private activateNextQueuedUserMessage(): void {
    const line = this.queuedUserLines.shift();
    if (line) delete line.label;
  }

  private appendAssistantMessage(message: Message): void {
    if (this.pendingAssistantIndex !== undefined) {
      const pending = this.transcript[this.pendingAssistantIndex];
      if (pending?.role === 'assistant') pending.content = message.content;
      this.pendingAssistantIndex = undefined;
      return;
    }
    this.transcript.push({ role: 'assistant', content: message.content });
  }

  private appendToolCall(call: Extract<CoreEvent, { type: 'tool_call' }>['call']): void {
    this.transcript.push({
      role: 'tool',
      callId: call.id,
      name: call.tool,
      argsPreview: formatToolCallArgs(call.tool, call.args),
    });
  }

  private appendError(error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);
    this.pendingAssistantIndex = undefined;
    this.pendingReasoningIndex = undefined;
    this.transcript.push({ role: 'error', content: msg });
    this.showErrorToast(msg);
    this.setStatus('error');
  }

  private showErrorToast(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastZone.children = [new ErrorToast(message)];
    if (this.toastZone.layout) this.toastZone.layout.height = 2;
    this.toastTimer = setTimeout(() => {
      this.clearToast();
    }, 6000);
  }

  private clearToast(): boolean {
    const hadToast = this.toastZone.children.length > 0;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = undefined;
    this.toastZone.children = [];
    if (this.toastZone.layout) this.toastZone.layout.height = 0;
    if (hadToast) this.tui.requestRender();
    return hadToast;
  }

  private appendReasoningDelta(content: string): void {
    if (this.pendingReasoningIndex === undefined) {
      const insertAt = this.pendingAssistantIndex ?? this.transcript.length;
      this.transcript.splice(insertAt, 0, {
        role: 'reasoning',
        content: '',
        closed: !this.thinkingVisible,
      });
      this.pendingReasoningIndex = insertAt;
      if (this.pendingAssistantIndex !== undefined) this.pendingAssistantIndex++;
    }
    const pending = this.transcript[this.pendingReasoningIndex];
    if (pending?.role === 'reasoning') pending.content += content;
  }

  private appendReasoningMessage(message: Message): void {
    if (this.pendingReasoningIndex !== undefined) {
      const pending = this.transcript[this.pendingReasoningIndex];
      if (pending?.role === 'reasoning') pending.content = message.content;
      this.pendingReasoningIndex = undefined;
      return;
    }
    const insertAt = this.pendingAssistantIndex ?? this.transcript.length;
    this.transcript.splice(insertAt, 0, {
      role: 'reasoning',
      content: message.content,
      closed: !this.thinkingVisible,
    });
    if (this.pendingAssistantIndex !== undefined) this.pendingAssistantIndex++;
  }

  private setStatus(status: string): void {
    this.status = status;
    this.updateSpinnerState();
    this.updateStatusLine();
  }

  private updateSpinnerState(): void {
    const busy = this.isBusyStatus(this.status);
    this.statusText.setBusy(busy);
    if (busy) this.startSpinner();
    else this.stopSpinner();
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
    this.latestContext = context;
    const used = context.usage?.promptTokens;
    const total = context.props?.n_ctx ?? context.currentSlot?.n_ctx;
    this.contextText =
      used !== undefined && total !== undefined ? `${used} (${Math.round((used / total) * 100)}%)` : '';
    this.updateStatusLine();
  }

  private updateStatusLine(): void {
    const ctx: StatusSlotContext = {
      busy: this.isBusyStatus(this.status),
      model: this.modelController?.getModel(),
      contextText: this.contextText,
    };
    this.statusText.setContent(STATUS_SLOTS.render('status.left', ctx), STATUS_SLOTS.render('status.right', ctx));
  }

  private renderTranscript(): void {
    const shouldStickToBottom = this.scrollView.isAtBottom();
    const theme = this.themeProvider.current();
    const lines: Component[] = [];
    for (const entry of this.transcript) {
      switch (entry.role) {
        case 'user':
          lines.push(new UserMessage({ content: entry.content, label: entry.label, theme }));
          break;
        case 'assistant':
          lines.push(new AssistantMessage({ content: entry.content }));
          break;
        case 'command':
          lines.push(new CommandLine(entry.content));
          break;
        case 'command_result':
          lines.push(new CommandResultLine(entry.content));
          break;
        case 'output_block':
          lines.push(entry.component);
          break;
        case 'context':
          lines.push(new ContextMap({ context: entry.context, model: this.modelController?.getModel() }));
          break;
        case 'reasoning':
          if (entry.closed) {
            lines.push(new HiddenThinkingLine(() => this.openThinkingLine(entry)));
          } else {
            lines.push(
              new ReasoningBlock({
                content: entry.content,
                layout: { width: 'fill', height: 'auto', padding: { left: 1, right: 1 } },
              }),
            );
          }
          break;
        case 'tool':
          lines.push(new ToolLine(entry.name, entry.argsPreview));
          break;
        case 'error':
          lines.push(new ErrorLine(entry.content));
          break;
      }
    }
    for (const entry of this.visibleQueuedLines) {
      lines.push(new UserMessage({ content: entry.line.content, label: entry.line.label, theme }));
    }
    this.scrollView.setChildren(lines, { stickToBottom: shouldStickToBottom });
    this.tui.requestRender();
  }
}
