import type { CoreEvent, LLMResponseContext, Message, Runtime, Unsubscribe } from 'mu-core';
import type { LocalModel } from 'mu-local-provider';
import { type Component, type InputEvent, type LayoutStyle, ProcessTerminal, type RenderContext, TUI } from 'mu-tui';
import { Box, Input, Modal, ScrollView, SelectList } from 'mu-tui/components';
import { AssistantMessage } from './components/AssistantMessage';
import { CommandPalette, type CommandPaletteItem } from './components/CommandPalette';
import { ReasoningBlock } from './components/ReasoningBlock';
import { UserMessage } from './components/UserMessage';
import { darkTheme, getTheme, lightTheme, styleToAnsi, type Theme, ThemeProvider } from './theme';

interface ChatLine {
  role: 'user' | 'assistant' | 'reasoning' | 'error';
  content: string;
}

interface ChatBus {
  publish: (event: CoreEvent) => void;
  subscribe: (fn: (event: CoreEvent) => void) => Unsubscribe;
}

interface ChatCommand extends CommandPaletteItem {
  run: (args: string) => void;
}

interface ModelController {
  listModels: () => Promise<LocalModel[]>;
  getModel: () => string;
  setModel: (model: string) => void;
}

type ModalMode = 'help' | 'model';

type ChatEvent = CoreEvent | { type: 'context_update'; context: LLMResponseContext };

const RESET = '\x1b[0m';

class StatusLine implements Component {
  layout: LayoutStyle;
  private _text: string;

  constructor(text: string) {
    this._text = text;
    this.layout = { width: 'fill', height: 1, zIndex: 10 };
  }

  setText(text: string): void {
    this._text = text;
  }

  render(ctx: RenderContext): string[] {
    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.muted);
    const padded = this._text.padEnd(ctx.contentRect.width, ' ');
    return [prefix ? `${prefix}${padded}${RESET}` : padded];
  }
}

class ErrorLine implements Component {
  layout: LayoutStyle;
  private content: string;

  constructor(content: string) {
    this.content = content;
    this.layout = { width: 'fill', height: 'auto' };
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefixSgr = styleToAnsi(theme.styles.errorPrefix);
    const bodySgr = styleToAnsi(theme.styles.errorLine);
    const head = prefixSgr ? `${prefixSgr}! ${RESET}` : '! ';
    const body = bodySgr ? `${bodySgr}${this.content}${RESET}` : this.content;
    return [`${head}${body}`];
  }
}

class ErrorToast implements Component {
  layout: LayoutStyle;

  constructor(private readonly content: string) {
    this.layout = { width: 'fill', height: 'auto', padding: { left: 1, right: 1, bottom: 1 }, zIndex: 20 };
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefixSgr = styleToAnsi(theme.styles.errorPrefix);
    const bodySgr = styleToAnsi(theme.styles.errorLine);
    const maxTextWidth = Math.max(0, width - 4);
    const text = this.content.length > maxTextWidth ? `${this.content.slice(0, Math.max(0, maxTextWidth - 3))}...` : this.content;
    const prefix = prefixSgr ? `${prefixSgr}!${RESET}` : '!';
    const body = bodySgr ? `${bodySgr}${text}${RESET}` : text;
    return [`${prefix} ${body}`.padEnd(width, ' ')];
  }
}

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
  private themeProvider: ThemeProvider;
  private unsubscribeTheme: (() => void) | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  private pendingAssistantIndex: number | undefined;
  private pendingReasoningIndex: number | undefined;

  constructor(
    runtime: Runtime,
    bus: ChatBus,
    private readonly modelController?: ModelController,
    private readonly onExit?: (code: number) => void,
  ) {
    this.runtime = runtime;
    this.bus = bus;
    this.models = [];

    this.themeProvider = new ThemeProvider(darkTheme);
    const theme = this.themeProvider.current();

    this.terminal = new ProcessTerminal({ keyboard: true, mouse: { drag: true, motion: true } });
    this.tui = new TUI(this.terminal, { userContext: this.themeProvider });

    this.scrollView = new ScrollView({
      layout: { width: 'fill', height: 'fill' },
      focusable: false,
    });

    this.transcriptBox = new Box({
      layout: { width: 'fill', height: 'fill' },
      children: [this.scrollView],
    });

    this.statusText = new StatusLine('ready');
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

    this.commandItems = this.createCommands();

    this.root = new Box({
      layout: {
        width: 'fill',
        height: 'fill',
        direction: 'column',
        padding: { left: 1, right: 1 },
        backgroundColor: theme.colors.background,
      },
      children: [
        this.transcriptBox,
        this.toastZone,
        this.inputTopWidgetZone,
        this.inputBox,
        this.inputBottomWidgetZone,
        this.statusBox,
      ],
    });

    this.tui.addChild(this.root);
    this.tui.setFocus(this.input);
    this.tui.addInputInterceptor((event) => this.interceptInput(event));
    this.tui.addGlobalKeybinding({
      chord: { key: 'c', ctrl: true },
      handler: () => this.handleCtrlC(),
    });
    this.tui.addGlobalKeybinding({
      chord: { key: 't', ctrl: true },
      handler: () => this.toggleTheme(),
    });

    this.unsubscribeTheme = this.themeProvider.subscribe((next) => this.applyTheme(next));
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
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = undefined;
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
    this.transcript.push({ role: 'user', content: text });
    this.setStatus('thinking...');
    this.renderTranscript();

    const message: Message = { role: 'user', content: text };
    this.bus.publish({ type: 'user_message', message });
  }

  private updateInputHeight(value: string): void {
    const lines = Math.min(7, Math.max(1, value.split('\n').length));
    this.input.layout.height = lines;
    if (this.inputBox.layout) this.inputBox.layout.height = lines + 2;
    this.updateCommandPalette(value);
  }

  private interceptInput(event: InputEvent): boolean {
    if (this.modal && event.type === 'key' && event.kind !== 'release') {
      if (this.modalMode === 'model') {
        return this.interceptModelModal(event);
      }
      if (event.key === 'escape' || event.key === 'esc' || event.key === 'enter') {
        this.closeModal();
        return true;
      }
    }

    if (event.type === 'key' && event.kind !== 'release' && (event.key === 'escape' || event.key === 'esc')) {
      if (this.clearToast()) return true;
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

  private createCommands(): ChatCommand[] {
    return [
      {
        name: 'help',
        description: 'show available commands',
        run: () => this.openHelpModal(),
      },
      {
        name: 'clear',
        description: 'clear the transcript',
        run: () => {
          this.transcript = [];
          this.pendingAssistantIndex = undefined;
          this.pendingReasoningIndex = undefined;
          this.renderTranscript();
        },
      },
      {
        name: 'model',
        description: 'switch the active model',
        run: () => this.openModelModal(),
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

  private openHelpModal(): void {
    const body = this.commandItems.map((command) => `/${command.name} - ${command.description}`);
    this.openModal('help', {
      title: 'Command Palette',
      body,
      footer: 'Esc or Enter to close',
      onClose: () => this.closeModal(),
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
    if (event.type === 'assistant_start') {
      this.setStatus('streaming...');
    } else if (event.type === 'assistant_delta') {
      if (this.pendingAssistantIndex === undefined) {
        this.transcript.push({ role: 'assistant', content: '' });
        this.pendingAssistantIndex = this.transcript.length - 1;
      }
      this.transcript[this.pendingAssistantIndex].content += event.content;
      this.setStatus('streaming...');
    } else if (event.type === 'assistant_message') {
      if (this.pendingAssistantIndex !== undefined) {
        this.transcript[this.pendingAssistantIndex].content = event.message.content;
        this.pendingAssistantIndex = undefined;
      } else {
        this.transcript.push({ role: 'assistant', content: event.message.content });
      }
      this.setStatus('ready');
    } else if (event.type === 'reasoning_delta') {
      this.appendReasoningDelta(event.content);
      this.setStatus('reasoning...');
    } else if (event.type === 'reasoning_message') {
      this.appendReasoningMessage(event.message);
      this.setStatus('reasoning...');
    } else if (event.type === 'tool_call') {
      this.setStatus(`tool: ${event.call.tool}`);
    } else if (event.type === 'tool_result') {
      this.setStatus('ready');
    } else if (event.type === 'context_update') {
      this.setContext(event.context);
    } else if (event.type === 'error') {
      const msg = event.error instanceof Error ? event.error.message : String(event.error);
      this.pendingAssistantIndex = undefined;
      this.pendingReasoningIndex = undefined;
      this.transcript.push({ role: 'error', content: msg });
      this.showErrorToast(msg);
      this.setStatus('error');
    }
    this.renderTranscript();
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
      this.transcript.splice(insertAt, 0, { role: 'reasoning', content: '' });
      this.pendingReasoningIndex = insertAt;
      if (this.pendingAssistantIndex !== undefined) this.pendingAssistantIndex++;
    }
    this.transcript[this.pendingReasoningIndex].content += content;
  }

  private appendReasoningMessage(message: Message): void {
    if (this.pendingReasoningIndex !== undefined) {
      this.transcript[this.pendingReasoningIndex].content = message.content;
      this.pendingReasoningIndex = undefined;
      return;
    }
    const insertAt = this.pendingAssistantIndex ?? this.transcript.length;
    this.transcript.splice(insertAt, 0, { role: 'reasoning', content: message.content });
    if (this.pendingAssistantIndex !== undefined) this.pendingAssistantIndex++;
  }

  private setStatus(status: string): void {
    this.status = status;
    this.updateStatusLine();
  }

  private setContext(context: LLMResponseContext): void {
    const used = context.usage?.promptTokens;
    const total = context.props?.n_ctx ?? context.currentSlot?.n_ctx;
    this.contextText = used !== undefined && total !== undefined ? `ctx ${used}/${total}` : '';
    this.updateStatusLine();
  }

  private updateStatusLine(): void {
    const model = this.modelController?.getModel();
    const parts = [this.status];
    if (model) parts.push(model);
    if (this.contextText) parts.push(this.contextText);
    this.statusText.setText(parts.join(' | '));
  }

  private renderTranscript(): void {
    const theme = this.themeProvider.current();
    const lines: Component[] = [];
    for (const entry of this.transcript) {
      if (entry.role === 'user') {
        lines.push(new UserMessage({ content: entry.content, theme }));
        continue;
      }

      if (entry.role === 'assistant') {
        lines.push(new AssistantMessage({ content: entry.content }));
        continue;
      }

      if (entry.role === 'reasoning') {
        lines.push(
          new ReasoningBlock({
            content: entry.content,
            layout: { width: 'fill', height: 'auto', padding: { left: 1, right: 1 } },
          }),
        );
        continue;
      }

      lines.push(new ErrorLine(entry.content));
    }
    this.scrollView.setChildren(lines);
    this.tui.requestRender();
  }
}
