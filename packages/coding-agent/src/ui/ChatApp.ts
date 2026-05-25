import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CoreEvent, LLMResponseContext, Message, Runtime, Unsubscribe } from 'mu-core';
import { appendHistory, loadHistory } from '../config';
import type { Model } from '../runtime';
import { RoundtripStore } from '../runtime/RoundtripStore';
import { type Component, type InputEvent, ProcessTerminal, TUI } from 'mu-tui';
import { Box, Input, type InputHighlight, Modal, ScrollView, SelectList, Text } from 'mu-tui/components';
import { AssistantMessage } from './components/AssistantMessage';
import { CommandPalette, type CommandPaletteItem } from './components/CommandPalette';
import { ContextMap } from './components/ContextMap';
import { type FilePickerEntry, FilePicker } from './components/FilePicker';
import { CommandLine, CommandResultLine, ErrorLine, ErrorToast, HiddenThinkingLine } from './components/SimpleLines';
import { OutputBlock } from './components/OutputBlock';
import { ReasoningBlock } from './components/ReasoningBlock';
import { ToolLine } from './components/ToolLine';
import { UserMessage } from './components/UserMessage';
import { WaitingList, type WaitingItem } from './components/WaitingList';
import { StatusLine } from './statusLine';
import { STATUS_SLOTS, type StatusSlotContext } from './statusSlots';
import { darkTheme, getTheme, lightTheme, styleToAnsi, type Theme, ThemeProvider } from './theme';
import { Transcript } from './Transcript';
import { formatTokens } from './formatTokens';

interface ChatBus {
  publish: (event: CoreEvent) => void;
  subscribe: (fn: (event: CoreEvent) => void) => Unsubscribe;
}

interface ChatCommand extends CommandPaletteItem {
  run: (args: string) => void;
  deferWhenBusy?: boolean;
}

interface ModelController {
  createRuntime: () => Runtime;
  listModels: () => Promise<Model[]>;
  getModel: () => string;
  setModel: (model: string) => void;
}

interface ChatAppOptions {
  thinkingVisible?: boolean;
  onThinkingVisibleChange?: (visible: boolean) => void;
}

type ModalMode = 'model';

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
  private commandItems: ChatCommand[] = [];
  private commandCursor = 0;
  private dismissedPaletteFor = '';
  private modal: Modal | undefined;
  private modalMode: ModalMode | undefined;
  private models: Model[] = [];
  private modelCursor = 0;
  private unsubscribe: Unsubscribe | undefined;
  private stopped = false;
  private status = 'ready';
  private contextText = '';
  private roundtrips = new RoundtripStore();
  private themeProvider: ThemeProvider;
  private unsubscribeTheme: (() => void) | undefined;
  private unsubscribeStatusSlots: (() => void) | undefined;
  private unregisterStatusSlotContributors: Array<() => void> = [];
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private spinnerTick = 0;
  private filePicker: FilePicker | undefined;
  private filePickerAnchor = -1;
  private filePickerCursor = 0;
  private lastEscTime = 0;
  private history: string[] = [];
  private historyCursor = -1;
  private historyDraft = '';
  private historyNavigating = false;
  private deferredCommandQueue: Array<{ label: string; run: () => void }> = [];
  private deferredDrainTimer: ReturnType<typeof setTimeout> | undefined;
  private waitingList: WaitingList | undefined;

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
    this.history = loadHistory();
    this.transcript = new Transcript(options.thinkingVisible ?? true);

    this.themeProvider = new ThemeProvider(darkTheme);
    const theme = this.themeProvider.current();

    this.terminal = new ProcessTerminal({ alternateScreen: true, keyboard: true, mouse: { drag: true, motion: true }, focusEvents: true });
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

    this.commandItems = this.createCommands();

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

    this.tui.addChild(this.root);
    this.tui.setFocus(this.input);
    this.tui.addInputInterceptor((event) => this.interceptInput(event));

    this.tui.addGlobalKeybinding({ chord: { key: 'c', ctrl: true }, handler: () => this.handleCtrlC() });
    this.tui.addGlobalKeybinding({ chord: { key: 't', ctrl: true }, handler: () => this.toggleTheme() });
    this.tui.addGlobalKeybinding({ chord: { key: 'o', ctrl: true }, handler: () => this.toggleOutputBlocks() });

    this.unsubscribeTheme = this.themeProvider.subscribe((next) => this.applyTheme(next));
    this.registerStatusSlots();
    this.updateStatusLine();
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    this.unsubscribe = this.bus.subscribe((event) => this.handleEvent(event));
    await this.runtime.start();
    this.tui.start();
    void this.loadModels();
  }

  private async loadModels(): Promise<void> {
    if (!this.modelController) return;
    try {
      this.models = await this.modelController.listModels();
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
    this.unsubscribeStatusSlots?.();
    this.unsubscribeStatusSlots = undefined;
    for (const unregister of this.unregisterStatusSlotContributors.splice(0)) unregister();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = undefined;
    if (this.deferredDrainTimer) clearTimeout(this.deferredDrainTimer);
    this.deferredDrainTimer = undefined;
    this.deferredCommandQueue.length = 0;
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

  private registerStatusSlots(): void {
    this.unregisterStatusSlotContributors.push(
      STATUS_SLOTS.register('status.left', () => undefined),
      STATUS_SLOTS.register('status.right', ({ contextText }) => contextText),
    );
    this.unsubscribeStatusSlots = STATUS_SLOTS.subscribe(() => {
      this.updateStatusLine();
      this.tui.requestRender();
    });
  }

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
    const roundtrip = this.roundtrips.record(context, this.modelController?.getModel());
    const used = roundtrip.usedTokens;
    const total = roundtrip.windowTokens;
    this.contextText = used !== undefined && total !== undefined
      ? `${formatTokens(used)}/${formatTokens(total)} (${Math.round((used / total) * 100)}%)`
      : '';
    this.updateStatusLine();
  }

  private updateModelLabel(): void {
    const modelId = this.modelController?.getModel() ?? '';
    if (!modelId) { this.modelLabel.setText(''); return; }
    const theme = this.themeProvider.current();
    const white = styleToAnsi({ fg: theme.colors.text });
    const dim = styleToAnsi({ fg: theme.colors.textMuted });
    const model = this.models.find((m) => m.id === modelId);
    const provider = model?.ownedBy ? `  ${dim}${model.ownedBy}\x1b[0m` : '';
    this.modelLabel.setText(`${white}${modelId}\x1b[0m${provider}`);
  }

  private updateStatusLine(): void {
    this.updateModelLabel();
    const ctx: StatusSlotContext = {
      busy: this.isBusyStatus(this.status),
      model: this.modelController?.getModel(),
      contextText: this.contextText,
    };
    this.statusText.setContent(STATUS_SLOTS.render('status.left', ctx), STATUS_SLOTS.render('status.right', ctx));
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
      this.transcript.appendUser(text);
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
    if (this.history[this.history.length - 1] !== text) {
      this.history.push(text);
    }
    this.historyCursor = -1;
    this.historyDraft = '';
    appendHistory(text);
  }

  private navigateHistory(direction: 'up' | 'down'): boolean {
    if (this.history.length === 0) return false;

    if (this.historyCursor === -1 && direction === 'down') return false;

    if (this.historyCursor === -1) {
      this.historyDraft = this.input.value;
      this.historyCursor = this.history.length - 1;
    } else if (direction === 'up') {
      if (this.historyCursor <= 0) return true;
      this.historyCursor--;
    } else {
      this.historyCursor++;
      if (this.historyCursor >= this.history.length) {
        this.historyCursor = -1;
        this.historyNavigating = true;
        this.input.setValue(this.historyDraft);
        this.updateInputHeight(this.historyDraft);
        this.historyNavigating = false;
        this.tui.requestRender();
        return true;
      }
    }

    const entry = this.history[this.historyCursor]!;
    this.historyNavigating = true;
    this.input.setValue(entry);
    this.updateInputHeight(entry);
    this.historyNavigating = false;
    this.tui.requestRender();
    return true;
  }

  private updateInputHeight(value: string): void {
    const inputLines = Math.min(7, Math.max(1, value.split('\n').length));
    this.input.layout.height = inputLines;
    if (this.inputRow.layout) this.inputRow.layout.height = inputLines;
    const inputBoxHeight = 1 + inputLines + 1 + 1 + 1;
    if (this.inputBox.layout) this.inputBox.layout.height = inputBoxHeight;
    if (!this.historyNavigating && this.historyCursor !== -1) {
      this.historyCursor = -1;
      this.historyDraft = '';
    }
    this.updateBashMode(value);
    this.updateCommandPalette(value);
    this.updateFilePicker(value);
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
    if (this.modal && event.type === 'key' && event.kind !== 'release') {
      return this.interceptModalInput(event);
    }

    if (event.type === 'key' && event.kind !== 'release' && (event.key === 'escape' || event.key === 'esc')) {
      if (this.clearToast()) return true;
      if (this.filePicker) return false;
      if (this.input.value.startsWith('!') || this.input.value.startsWith('$') || this.input.value.startsWith('/')) {
        this.input.setValue('');
        this.updateInputHeight('');
        this.tui.requestRender();
        return true;
      }
      if (this.runtime.state() === 'running') {
        const now = Date.now();
        const elapsed = now - this.lastEscTime;
        if (this.lastEscTime > 0 && elapsed > 100 && elapsed < 1500) {
          this.lastEscTime = 0;
          void this.cancelGeneration();
        } else if (elapsed > 100 || this.lastEscTime === 0) {
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

    if (event.type === 'key' && event.kind !== 'release' && this.filePicker && !this.commandPalette) {
      if (this.interceptFilePickerInput(event)) return true;
    }

    if (event.type === 'key' && event.kind !== 'release' && !this.commandPalette && !this.filePicker) {
      if (event.key === 'up') return this.navigateHistory('up');
      if (event.key === 'down') return this.navigateHistory('down');
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

  // --- Commands ---

  private createCommands(): ChatCommand[] {
    return [
      { name: 'new', description: 'start a new session', run: () => this.startNewSession() },
      { name: 'model', description: 'switch the active model', run: () => this.openModelModal() },
      // { name: 'context', description: 'show context map', deferWhenBusy: true, run: () => this.showContextMap() },
      { name: 'context-export', description: 'export context map to a file', deferWhenBusy: true, run: (args) => void this.exportContext(args) },
      { name: 'thinking', description: 'toggle thinking blocks', deferWhenBusy: true, run: () => this.handleToggleThinking() },
      { name: 'expand', description: 'toggle output block expansion', deferWhenBusy: true, run: () => this.toggleOutputBlocks() },
      { name: 'quit', description: 'exit the agent', run: () => void this.stop().then(() => this.onExit?.(0)) },
    ];
  }

  private executeCommand(command: ChatCommand, args: string): void {
    if (command.deferWhenBusy && this.runtime.state() !== 'idle') {
      const label = args ? `/${command.name} ${args}` : `/${command.name}`;
      this.deferredCommandQueue.push({ label, run: () => command.run(args) });
      this.updateWaitingList();
      return;
    }
    command.run(args);
  }

  private drainDeferredCommands(): void {
    this.deferredDrainTimer = undefined;
    if (this.runtime.state() !== 'idle') return;
    if (this.deferredCommandQueue.length === 0) return;
    const queue = this.deferredCommandQueue.splice(0);
    this.updateWaitingList();
    for (const entry of queue) {
      try { entry.run(); } catch { /* ignore */ }
    }
  }

  private scheduleDeferredDrain(): void {
    if (this.deferredDrainTimer) return;
    if (this.deferredCommandQueue.length === 0) return;
    this.deferredDrainTimer = setTimeout(() => this.drainDeferredCommands(), 0);
  }

  private collectWaitingItems(): WaitingItem[] {
    const items: WaitingItem[] = [];
    for (const entry of this.transcript.visibleQueuedLines) {
      items.push({ kind: entry.queue, text: entry.line.content });
    }
    for (const entry of this.deferredCommandQueue) {
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
    if (!value.startsWith('/') || value.includes(' ') || value === this.dismissedPaletteFor) return [];
    const query = value.slice(1).toLowerCase();
    return this.commandItems.filter((command) => command.name.toLowerCase().startsWith(query));
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
      this.runShellCommand(value.slice(1).trim());
      return true;
    }
    if (!value.startsWith('/')) return false;
    const [rawName, ...rest] = value.slice(1).split(/\s+/);
    const command = this.commandItems.find((item) => item.name === rawName);
    if (!command) {
      this.transcript.lines.push({ role: 'error', content: `Unknown command: /${rawName}` });
      this.renderTranscript();
      return true;
    }
    this.executeCommand(command, rest.join(' '));
    return true;
  }

  // --- File Picker ---

  private findActiveAtMention(value: string): { anchor: number; token: string } | undefined {
    const cursor = this.input.cursor;
    for (let i = cursor - 1; i >= 0; i--) {
      if (value[i] === ' ' || value[i] === '\n') return undefined;
      if (value[i] === '@') {
        const token = value.slice(i + 1, cursor);
        return { anchor: i, token };
      }
    }
    return undefined;
  }

  private updateFilePicker(value: string): void {
    if (this.commandPalette) {
      this.dismissFilePicker();
      return;
    }

    const mention = this.findActiveAtMention(value);
    if (!mention) {
      this.dismissFilePicker();
      return;
    }

    this.filePickerAnchor = mention.anchor;
    this.filePickerCursor = 0;

    this.filePicker = new FilePicker({
      cwd: process.cwd(),
      query: mention.token,
      selectedIndex: this.filePickerCursor,
      onSelect: (entry) => this.selectFilePickerEntry(entry),
    });

    const count = this.filePicker.visibleEntries.length;
    if (count === 0) {
      this.dismissFilePicker();
      return;
    }

    const visibleHeight = Math.min(8, count);
    this.inputTopWidgetZone.children = [this.filePicker];
    if (this.inputTopWidgetZone.layout) this.inputTopWidgetZone.layout.height = visibleHeight;
    this.updateDockHeight();
  }

  private dismissFilePicker(): void {
    if (!this.filePicker) return;
    this.filePicker = undefined;
    this.filePickerAnchor = -1;
    this.filePickerCursor = 0;
    if (!this.commandPalette) {
      this.inputTopWidgetZone.children = [];
      if (this.inputTopWidgetZone.layout) this.inputTopWidgetZone.layout.height = 0;
      this.updateDockHeight();
    }
  }

  private selectFilePickerEntry(entry: FilePickerEntry): void {
    const value = this.input.value;
    const cursor = this.input.cursor;
    const anchor = this.filePickerAnchor;
    if (anchor < 0) return;

    const before = value.slice(0, anchor + 1);
    const after = value.slice(cursor);
    const insertPath = entry.path;

    const newValue = `${before}${insertPath}${after}`;
    const newCursor = anchor + 1 + insertPath.length;
    this.input.setValue(newValue);
    this.input.setCursor(newCursor);
    this.updateHighlights(newValue);
    this.dismissFilePicker();
    this.tui.requestRender();
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

  private interceptFilePickerInput(event: Extract<InputEvent, { type: 'key' }>): boolean {
    if (!this.filePicker) return false;

    const entries = this.filePicker.visibleEntries;
    if (entries.length === 0) return false;

    if (event.key === 'up') {
      this.filePickerCursor = Math.max(0, this.filePickerCursor - 1);
      this.filePicker.setSelectedIndex(this.filePickerCursor);
      this.tui.requestRender();
      return true;
    }
    if (event.key === 'down') {
      this.filePickerCursor = Math.min(entries.length - 1, this.filePickerCursor + 1);
      this.filePicker.setSelectedIndex(this.filePickerCursor);
      this.tui.requestRender();
      return true;
    }
    if (event.key === 'tab' || event.key === 'enter') {
      const entry = entries[this.filePickerCursor];
      if (entry) this.selectFilePickerEntry(entry);
      return true;
    }
    if (event.key === 'escape' || event.key === 'esc') {
      this.dismissFilePicker();
      this.tui.requestRender();
      return true;
    }
    return false;
  }

  private runShellCommand(cmd: string): void {
    const theme = this.themeProvider.current();
    const entry = { role: 'output_block' as const, component: new OutputBlock({ command: cmd, output: '', theme }) };
    this.transcript.lines.push(entry);
    this.renderTranscript();

    let stdout = '';
    let stderr = '';
    const proc = spawn('bash', ['-c', cmd], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });
    proc.on('close', (code) => {
      const output = code !== 0 || stderr ? [stdout, stderr].filter(Boolean).join('\n') : stdout;
      entry.component = new OutputBlock({ command: cmd, output: output.trim() || '(no output)', theme });
      this.renderTranscript();
    });
    proc.on('error', (err) => {
      entry.component = new OutputBlock({ command: cmd, output: err.message, variant: 'error', theme });
      this.renderTranscript();
    });
  }

  private async cancelGeneration(): Promise<void> {
    if (!this.modelController) return;
    await this.runtime.stop();
    this.runtime = this.modelController.createRuntime();
    await this.runtime.start();
    this.transcript.visibleQueuedLines.length = 0;
    this.updateWaitingList();
    this.stopSpinner();
    this.setStatus('cancelled');
    this.tui.requestRender();
    this.scheduleDeferredDrain();
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

    await this.runtime.stop();
    this.runtime = this.modelController.createRuntime();
    await this.runtime.start();
    this.transcript.reset();
    this.deferredCommandQueue.length = 0;
    this.contextText = '';
    this.roundtrips.clear();
    this.setStatus('new session');
    this.updateWaitingList();
    this.renderTranscript();
  }

  private showContextMap(): void {
    this.transcript.lines.push({ role: 'command', content: '/context' });
    this.transcript.lines.push({ role: 'context', roundtrip: this.roundtrips.latest() });
    this.renderTranscript();
  }

  private async exportContext(args: string): Promise<void> {
    const history = this.roundtrips.all();
    if (history.length === 0) {
      this.showErrorToast('No context available to export.');
      return;
    }

    const outputPath = args.trim() || '.mu/context.json';
    const resolvedPath = resolve(outputPath);
    const payload = {
      exportedAt: new Date().toISOString(),
      model: this.modelController?.getModel(),
      roundtrips: history,
    };

    try {
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      this.transcript.lines.push({ role: 'command', content: `/context-export ${outputPath}` });
      this.transcript.lines.push({ role: 'command_result', content: `saved context to ${outputPath}` });
      this.renderTranscript();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showErrorToast(`Failed to export context: ${message}`);
    }
  }

  private handleToggleThinking(): void {
    this.transcript.toggleThinking();
    this.options.onThinkingVisibleChange?.(this.transcript.thinkingVisible);
    this.renderTranscript();
  }

  private toggleOutputBlocks(): void {
    const blocks = this.transcript.lines
      .filter((e): e is Extract<typeof e, { role: 'output_block' }> => e.role === 'output_block')
      .map((e) => e.component);
    if (blocks.length === 0) return;
    const allExpanded = blocks.every((b) => b.expanded);
    for (const b of blocks) b.expanded = !allExpanded;
    this.renderTranscript();
  }

  // --- Model picker modal ---

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
      contentPaddingX: 0,
      onClose: () => this.closeModal(),
    });

    void this.loadModelsForModal();
  }

  private async loadModelsForModal(): Promise<void> {
    if (!(this.modelController && this.modal) || this.modalMode !== 'model') return;
    try {
      this.models = await this.modelController.listModels();
      const current = this.modelController.getModel();
      this.modelCursor = Math.max(0, this.models.findIndex((model) => model.id === current));
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

    const maxIdWidth = this.models.reduce((max, m) => Math.max(max, m.id.length), 0);
    const DIM = '\x1b[2m';
    const items = this.models.map((model) => {
      const pad = ' '.repeat(maxIdWidth - model.id.length);
      const provider = model.ownedBy ? `  ${model.ownedBy}` : '';
      return {
        label: `${model.id}${pad}${DIM}${provider}`,
        selectedLabel: `${model.id}${pad}${provider}`,
        value: model,
      };
    });

    const selectList = new SelectList<Model>({
      items,
      selectedIndex: this.modelCursor,
      itemPaddingX: 2,
      onChange: (_item, index) => {
        this.modelCursor = index;
      },
      onSelect: (item) => {
        if (item.value) this.selectModelById(item.value.id);
      },
      layout: { width: 'fill', height: 'fill' },
      resolveStyles: (ctx) => {
        const theme = getTheme(ctx);
        return {
          item: styleToAnsi(theme.styles.commandPaletteItem),
          selected: styleToAnsi(theme.styles.commandPaletteSelected),
          hovered: styleToAnsi(theme.styles.commandPaletteHover),
        };
      },
    });

    const visibleRows = Math.min(items.length, 10);
    this.modal.setSize(undefined, visibleRows + 2);

    this.modal.setContent({
      title: 'Model Picker',
      footer: `Current: ${current || 'unknown'}`,
      content: selectList,
    });
    this.tui.setFocus(selectList);
    this.tui.requestRender(true);
  }

  private interceptModalInput(event: Extract<InputEvent, { type: 'key' }>): boolean {
    if (this.modalMode === 'model') {
      if (event.key === 'escape' || event.key === 'esc') {
        this.closeModal();
        return true;
      }
      return false;
    }

    if (event.key === 'escape' || event.key === 'esc' || event.key === 'enter') {
      this.closeModal();
      return true;
    }

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

  // --- Event handling ---

  private handleEvent(event: CoreEvent): void {
    switch (event.type) {
      case 'assistant_start':
        this.transcript.activateNextQueuedUserMessage();
        this.setStatus('streaming...');
        break;
      case 'assistant_delta':
        this.transcript.activateNextQueuedUserMessage();
        this.transcript.appendAssistantDelta(event.content);
        this.setStatus('streaming...');
        break;
      case 'assistant_message':
        this.transcript.activateNextQueuedUserMessage();
        this.transcript.appendAssistantMessage(event.message);
        this.setStatus('ready');
        break;
      case 'reasoning_delta':
        this.transcript.activateNextQueuedUserMessage();
        this.transcript.appendReasoningDelta(event.content);
        this.setStatus('reasoning...');
        break;
      case 'reasoning_message':
        this.transcript.activateNextQueuedUserMessage();
        this.transcript.appendReasoningMessage(event.message);
        this.setStatus('reasoning...');
        break;
      case 'tool_call':
        this.transcript.activateNextQueuedUserMessage();
        this.transcript.appendToolCall(event.call);
        this.setStatus(`tool: ${event.call.tool}`);
        break;
      case 'tool_result':
        this.setStatus('ready');
        break;
      case 'context_update':
        this.setContext(event.context);
        break;
      case 'queued_message':
        this.transcript.appendQueuedMessage(event.message, event.queue);
        this.updateWaitingList();
        break;
      case 'queue_update':
        break;
      case 'error': {
        const msg = event.error instanceof Error ? event.error.message : String(event.error);
        this.transcript.appendError(msg);
        this.showErrorToast(msg);
        this.setStatus('error');
        break;
      }
    }
    this.renderTranscript();
    this.scheduleDeferredDrain();
  }

  // --- Rendering ---

  private renderTranscript(): void {
    const shouldStickToBottom = this.scrollView.isAtBottom();
    const theme = this.themeProvider.current();
    const components: Component[] = [];
    for (const entry of this.transcript.lines) {
      switch (entry.role) {
        case 'user':
          components.push(new UserMessage({ content: entry.content, label: entry.label, theme }));
          break;
        case 'assistant':
          components.push(new AssistantMessage({ content: entry.content }));
          break;
        case 'command':
          components.push(new CommandLine(entry.content));
          break;
        case 'command_result':
          components.push(new CommandResultLine(entry.content));
          break;
        case 'output_block':
          components.push(entry.component);
          break;
        case 'context':
          components.push(new ContextMap({ roundtrip: entry.roundtrip, model: this.modelController?.getModel() }));
          break;
        case 'reasoning':
          if (entry.closed) {
            components.push(new HiddenThinkingLine(() => {
              this.transcript.openThinkingLine(entry);
              this.renderTranscript();
            }));
          } else {
            components.push(
              new ReasoningBlock({
                content: entry.content,
                layout: { width: 'fill', height: 'auto', padding: { left: 1, right: 1 } },
              }),
            );
          }
          break;
        case 'tool':
          components.push(new ToolLine(entry.name, entry.argsPreview));
          break;
        case 'error':
          components.push(new ErrorLine(entry.content));
          break;
      }
    }
    this.scrollView.setChildren(components, { stickToBottom: shouldStickToBottom });
    this.tui.requestRender();
  }
}
