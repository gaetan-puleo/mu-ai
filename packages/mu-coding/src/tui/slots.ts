/**
 * TUI slot registry — host-owned, plugin-facing.
 *
 * Plugins (or the host itself) register **contributors** against a well-
 * known slot id. The Ink tree subscribes via `useSlot(id)` and renders all
 * non-null contributions inline.
 *
 * The registry is intentionally lightweight:
 *   - Lives in module scope (same pattern as the existing *_BRIDGE
 *     singletons in `tui.tsx`) so non-React plugin code can call into it
 *     without dragging in Ink.
 *   - Re-renders are driven by a monotonically increasing version counter;
 *     `useSlot` subscribes via `useEffect` and force-updates on bumps.
 *   - Each `register(id, fn)` returns an unsubscribe function. The fn is
 *     invoked during render: it MUST be cheap and side-effect-free.
 *   - If underlying state changes (e.g. active agent flipped), the
 *     contributor's owner must call `TUI_SLOTS.notify()` to trigger a re-
 *     render. We deliberately do not auto-subscribe to external state — the
 *     slot system has no opinion on how contributors read their data.
 *
 * Known slot ids (kept here so collisions are easy to spot):
 *   - 'assistantLine' — single text line directly above the prompt input.
 *     Reserved for short, dimmable status (e.g. current model / agent).
 *
 * Contributor return value: `React.ReactNode`. Return `null` to opt out of
 * the current render (e.g. "no active agent"). The slot host filters nulls
 * before composing.
 */

import React from 'react';

type SlotRenderer = () => React.ReactNode;

class SlotRegistry {
  private slots = new Map<string, SlotRenderer[]>();
  private listeners = new Set<() => void>();

  /**
   * Register a contributor for `slotId`. The returned function detaches it.
   * Registration order is preserved and matches render order.
   */
  register(slotId: string, render: SlotRenderer): () => void {
    const list = this.slots.get(slotId) ?? [];
    list.push(render);
    this.slots.set(slotId, list);
    this.bump();
    return () => {
      const cur = this.slots.get(slotId);
      if (!cur) return;
      const i = cur.indexOf(render);
      if (i >= 0) cur.splice(i, 1);
      if (cur.length === 0) this.slots.delete(slotId);
      this.bump();
    };
  }

  /**
   * Force every subscriber to re-render. Call when underlying state that a
   * contributor reads has changed (e.g. active agent switched).
   */
  notify(): void {
    this.bump();
  }

  /**
   * Invoke every contributor for `slotId` in registration order and return
   * the resulting nodes (nulls/undefineds NOT filtered — that's the host's
   * responsibility so it can decide whether to render empty separators).
   */
  render(slotId: string): React.ReactNode[] {
    const list = this.slots.get(slotId);
    if (!list || list.length === 0) return [];
    const out: React.ReactNode[] = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const fn = list[i];
      out[i] = fn ? fn() : null;
    }
    return out;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Test helper: count contributors registered against `slotId`. */
  size(slotId: string): number {
    return this.slots.get(slotId)?.length ?? 0;
  }

  /** Test helper: drop all contributors and listeners. */
  reset(): void {
    this.slots.clear();
    this.listeners.clear();
  }

  private bump(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* listener errors must not break the registry */
      }
    }
  }
}

export const TUI_SLOTS = new SlotRegistry();

/**
 * Subscribe to a slot and return its current contributions. Re-renders the
 * owning component whenever any contributor is registered/unregistered, or
 * when `TUI_SLOTS.notify()` is called.
 *
 * Nulls / undefineds are filtered so callers can join with separators
 * without rendering blank gaps.
 */
export function useSlot(slotId: string): React.ReactNode[] {
  const [, force] = React.useState(0);
  React.useEffect(() => TUI_SLOTS.subscribe(() => force((v) => v + 1)), []);
  const all = TUI_SLOTS.render(slotId);
  const out: React.ReactNode[] = [];
  for (const node of all) {
    if (node === null || node === undefined || node === false || node === '') continue;
    out.push(node);
  }
  return out;
}
