import type { InputEvent } from '../events';
import type { Component, Surface } from '../surface';
import { box } from '../views';
import { type Editor, editor } from './editor';
import { type SelectList, selectList } from './select-list';

export interface Command {
  id: string;
  label: string;
  run: () => void;
}

export interface CommandPaletteOptions {
  onRun: (command: Command) => void;
  placeholder?: string;
  width?: number;
}

export class CommandPalette implements Component {
  private readonly query: Editor;
  private readonly list: SelectList<Command>;
  private readonly width: number;
  private readonly onRun: (command: Command) => void;

  constructor(private readonly commands: Command[], opts: CommandPaletteOptions) {
    this.onRun = opts.onRun;
    this.width = opts.width ?? 60;
    this.query = editor({ placeholder: opts.placeholder ?? 'Rechercher une commande…' });
    this.list = selectList<Command>([]);
    this.refilter();
  }

  render(s: Surface): void {
    s.fill({ x: 0, y: 0, width: s.width, height: s.height }, '#000000', 0.5);

    const panel: Component = {
      render: (ps) => {
        ps.child(this.query, { x: 0, y: 0, width: ps.width, height: 1 }, { focused: true });
        const listHeight = ps.measure(this.list, ps.width);
        ps.child(this.list, { x: 0, y: 1, width: ps.width, height: listHeight });
      },
    };
    const boxed = box(panel, { border: true, background: '#1c1c1c' });

    const w = Math.min(this.width, Math.max(0, s.width - 2));
    const h = Math.min(s.measure(boxed, w), Math.max(0, s.height - 2));
    const x = Math.max(0, Math.floor((s.width - w) / 2));
    const y = Math.max(0, Math.floor((s.height - h) / 3));
    s.child(boxed, { x, y, width: w, height: h });
  }

  handleInput(event: InputEvent): void {
    if (event.type === 'key' && event.kind !== 'release') {
      if (event.key === 'up') {
        this.list.move(-1);
        return;
      }
      if (event.key === 'down') {
        this.list.move(1);
        return;
      }
      if (event.key === 'enter') {
        const item = this.list.selectedItem();
        if (item) this.onRun(item.value);
        return;
      }
    }
    this.query.handleInput(event);
    this.refilter();
  }

  private refilter(): void {
    const query = this.query.getValue().toLowerCase();
    const matched = this.commands.filter((command) => command.label.toLowerCase().includes(query));
    this.list.setItems(matched.map((command) => ({ label: command.label, value: command })));
  }
}

export const commandPalette = (commands: Command[], opts: CommandPaletteOptions): CommandPalette =>
  new CommandPalette(commands, opts);
