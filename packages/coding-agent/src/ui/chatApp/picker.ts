import type { Component, InputEvent } from 'mu-tui';
import { Modal, SelectList } from 'mu-tui/components';
import type { Model } from 'mu-harness';
import { FilePicker, type PickerEntry } from '../components/FilePicker';
import { getTheme, styleToAnsi } from '../theme';

export interface AgentDisplay {
  name: string;
  color?: string;
  description?: string;
}

export interface FilePickerHostInput {
  readonly value: string;
  readonly cursor: number;
  setValue(value: string): void;
  setCursor(cursor: number): void;
}

export interface FilePickerHost {
  /** Active input element (the picker reads value/cursor + writes selection back). */
  readonly input: FilePickerHostInput;
  /** Agents to show in the dropdown header above file matches. */
  collectMentionableAgents: () => AgentDisplay[];
  /** Mount/unmount + height of the top widget zone above the input. */
  mount: (component: FilePicker | undefined, height: number) => void;
  /** Called after a selection replaces text so highlights can refresh. */
  onValueChanged: (value: string) => void;
  /** Request a render after layout changes. */
  requestRender: () => void;
}

/**
 * The @-mention file/agent picker controller. Owns its small state machine and
 * the FilePicker component currently mounted (if any). The host wires the
 * picker into the input layout and provides the input adapter.
 */
export class FilePickerController {
  private picker: FilePicker | undefined;
  private anchor = -1;
  private cursor = 0;

  constructor(private readonly host: FilePickerHost) {}

  get visible(): boolean {
    return !!this.picker;
  }

  /** Scan backward from the input cursor for an open `@token` (no whitespace). */
  private findActiveMention(): { anchor: number; token: string } | undefined {
    const value = this.host.input.value;
    const cursor = this.host.input.cursor;
    for (let i = cursor - 1; i >= 0; i--) {
      if (value[i] === ' ' || value[i] === '\n') return undefined;
      if (value[i] === '@') {
        const token = value.slice(i + 1, cursor);
        return { anchor: i, token };
      }
    }
    return undefined;
  }

  /** Refresh the picker against the current input value (no-op when nothing to show). */
  update(): void {
    const mention = this.findActiveMention();
    if (!mention) {
      this.dismiss();
      return;
    }

    this.anchor = mention.anchor;
    this.cursor = 0;

    this.picker = new FilePicker({
      cwd: process.cwd(),
      query: mention.token,
      agents: this.host.collectMentionableAgents(),
      selectedIndex: this.cursor,
      onSelect: (entry) => this.selectEntry(entry),
    });

    const count = this.picker.visibleEntries.length;
    if (count === 0) {
      this.dismiss();
      return;
    }

    const visibleHeight = Math.min(8, count);
    this.host.mount(this.picker, visibleHeight);
  }

  dismiss(): void {
    if (!this.picker) return;
    this.picker = undefined;
    this.anchor = -1;
    this.cursor = 0;
    this.host.mount(undefined, 0);
  }

  private selectEntry(entry: PickerEntry): void {
    const value = this.host.input.value;
    const cursorPos = this.host.input.cursor;
    const anchor = this.anchor;
    if (anchor < 0) return;

    const before = value.slice(0, anchor + 1);
    const after = value.slice(cursorPos);
    const insertText = entry.kind === 'agent' ? entry.name : entry.path;

    const newValue = `${before}${insertText}${after}`;
    const newCursor = anchor + 1 + insertText.length;
    this.host.input.setValue(newValue);
    this.host.input.setCursor(newCursor);
    this.host.onValueChanged(newValue);
    this.dismiss();
    this.host.requestRender();
  }

  /** Returns true if the event was consumed by the picker. */
  intercept(event: Extract<InputEvent, { type: 'key' }>): boolean {
    if (!this.picker) return false;
    const entries = this.picker.visibleEntries;
    if (entries.length === 0) return false;

    if (event.key === 'up') {
      this.cursor = Math.max(0, this.cursor - 1);
      this.picker.setSelectedIndex(this.cursor);
      this.host.requestRender();
      return true;
    }
    if (event.key === 'down') {
      this.cursor = Math.min(entries.length - 1, this.cursor + 1);
      this.picker.setSelectedIndex(this.cursor);
      this.host.requestRender();
      return true;
    }
    if (event.key === 'tab' || event.key === 'enter') {
      const entry = entries[this.cursor];
      if (entry) this.selectEntry(entry);
      return true;
    }
    if (event.key === 'escape' || event.key === 'esc') {
      this.dismiss();
      this.host.requestRender();
      return true;
    }
    return false;
  }
}

/**
 * Build the SelectList that drives the model picker modal. Caller mounts it
 * into a `Modal.setContent({ content: ... })`.
 */
function buildModelSelectList(opts: {
  models: Model[];
  selectedIndex: number;
  onCursorChange: (index: number) => void;
  onPick: (id: string) => void;
}): SelectList<Model> {
  const maxIdWidth = opts.models.reduce((max, m) => Math.max(max, m.id.length), 0);
  const DIM = '\x1b[2m';
  const items = opts.models.map((model) => {
    const pad = ' '.repeat(maxIdWidth - model.id.length);
    const provider = model.ownedBy ? `  ${model.ownedBy}` : '';
    return {
      label: `${model.id}${pad}${DIM}${provider}`,
      selectedLabel: `${model.id}${pad}${provider}`,
      value: model,
    };
  });

  return new SelectList<Model>({
    items,
    selectedIndex: opts.selectedIndex,
    itemPaddingX: 2,
    onChange: (_item, index) => opts.onCursorChange(index),
    onSelect: (item) => {
      if (item.value) opts.onPick(item.value.id);
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
}

export interface ModelControllerLike {
  listModels: () => Promise<Model[]>;
  readonly model: string;
  setModel: (model: string) => void;
}

export interface ModelPickerHost {
  /** Returns 'idle' when a switch is safe; any other state blocks the picker. */
  runtimeState: () => string;
  /** Mount/unmount a Modal at the root level. */
  mountModal: (modal: Modal | undefined) => void;
  /** Pass focus to a component inside the modal (the select list). */
  setFocus: (component: Component) => void;
  /** Restore focus to the input when the modal closes. */
  restoreFocus: () => void;
  /** Hard re-render (for modal layout changes). */
  requestRender: (force?: boolean) => void;
  /** Push a status message to the status line (used after a successful pick). */
  setStatus: (status: string) => void;
}

/**
 * Owns the model picker modal lifecycle + the current cursor/model cache used
 * to repopulate the modal when reopened. ChatApp delegates a single openPicker()
 * + isOpen + handleKey to keep its surface focused on orchestration.
 */
export class ModelPickerController {
  private modal: Modal | undefined;
  private models: Model[] = [];
  private cursor = 0;

  constructor(private readonly host: ModelPickerHost, private readonly modelController?: ModelControllerLike) {}

  get isOpen(): boolean {
    return !!this.modal;
  }

  /** Current list of models — refreshed asynchronously when the modal opens. */
  get list(): Model[] {
    return this.models;
  }

  /** Seed the cached model list (e.g. from a startup probe). */
  setList(models: Model[]): void {
    this.models = models;
  }

  open(): void {
    if (!this.modelController) {
      this.openShell({ body: 'No model controller is configured.', footer: 'Esc or Enter to close' });
      return;
    }
    if (this.host.runtimeState() !== 'idle') {
      this.openShell({ body: 'Cannot switch model while a response is running.', footer: 'Esc or Enter to close' });
      return;
    }

    this.openShell({
      body: `Loading models...\nCurrent: ${this.modelController.model || 'unknown'}`,
      footer: 'Up/Down to move, Enter to select, Esc to close',
      contentPaddingX: 0,
    });
    void this.loadAndMount();
  }

  close(): void {
    if (!this.modal) return;
    this.host.mountModal(undefined);
    this.modal = undefined;
    this.host.restoreFocus();
    this.host.requestRender(true);
  }

  /** Called by ChatApp's input interceptor while a modal is mounted. */
  handleKey(event: Extract<InputEvent, { type: 'key' }>): boolean {
    if (event.key === 'escape' || event.key === 'esc') {
      this.close();
      return true;
    }
    return false;
  }

  private openShell(props: { body: string; footer: string; contentPaddingX?: number }): void {
    const modal = new Modal({
      title: 'Model Picker',
      body: props.body,
      footer: props.footer,
      contentPaddingX: props.contentPaddingX,
      onClose: () => this.close(),
    });
    this.modal = modal;
    this.host.mountModal(modal);
    this.host.setFocus(modal);
    this.host.requestRender(true);
  }

  private async loadAndMount(): Promise<void> {
    if (!(this.modelController && this.modal)) return;
    try {
      this.models = await this.modelController.listModels();
      const current = this.modelController.model;
      this.cursor = Math.max(0, this.models.findIndex((model) => model.id === current));
      this.mountSelectList();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.modal.setContent({
        title: 'Model Picker',
        body: `Failed to list models:\n${message}`,
        footer: 'Esc or Enter to close',
        content: undefined,
      });
      this.host.requestRender(true);
    }
  }

  private mountSelectList(): void {
    if (!this.modal) return;
    const current = this.modelController?.model ?? '';

    if (this.models.length === 0) {
      this.modal.setContent({
        title: 'Model Picker',
        body: 'No models available.',
        footer: 'Esc to close',
        content: undefined,
      });
      this.host.requestRender(true);
      return;
    }

    const selectList = buildModelSelectList({
      models: this.models,
      selectedIndex: this.cursor,
      onCursorChange: (index) => {
        this.cursor = index;
      },
      onPick: (id) => this.pick(id),
    });

    const visibleRows = Math.min(this.models.length, 10);
    this.modal.setSize(undefined, visibleRows + 2);

    this.modal.setContent({
      title: 'Model Picker',
      footer: `Current: ${current || 'unknown'}`,
      content: selectList,
    });
    this.host.setFocus(selectList);
    this.host.requestRender(true);
  }

  private pick(id: string): void {
    if (!this.modelController) {
      this.close();
      return;
    }
    this.modelController.setModel(id);
    this.host.setStatus(`model: ${id}`);
    this.close();
  }
}
