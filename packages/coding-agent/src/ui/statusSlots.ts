export type StatusSlotId = 'status.left' | 'status.right';

export interface StatusSlotContext {
  busy: boolean;
  model?: string;
  contextText?: string;
}

export type StatusSlotRenderer = (ctx: StatusSlotContext) => string | undefined | null | false;

class StatusSlotRegistry {
  private slots = new Map<StatusSlotId, StatusSlotRenderer[]>();
  private listeners = new Set<() => void>();

  register(slotId: StatusSlotId, render: StatusSlotRenderer): () => void {
    const list = this.slots.get(slotId) ?? [];
    list.push(render);
    this.slots.set(slotId, list);
    this.notify();
    return () => {
      const current = this.slots.get(slotId);
      if (!current) return;
      const index = current.indexOf(render);
      if (index !== -1) current.splice(index, 1);
      if (current.length === 0) this.slots.delete(slotId);
      this.notify();
    };
  }

  render(slotId: StatusSlotId, ctx: StatusSlotContext): string[] {
    const list = this.slots.get(slotId);
    if (!list?.length) return [];

    const out: string[] = [];
    for (const render of list) {
      const value = render(ctx);
      if (value) out.push(value);
    }
    return out;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  notify(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  reset(): void {
    this.slots.clear();
    this.listeners.clear();
  }
}

export const STATUS_SLOTS = new StatusSlotRegistry();
