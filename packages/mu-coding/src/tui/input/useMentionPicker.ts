import type { MentionCompletion, PluginRegistry } from 'mu-core';
import { useCallback, useEffect, useState } from 'react';

export interface MentionPickerState {
  /** Current trigger character (e.g. "@") when the picker is active. */
  trigger: string | null;
  /** Partial text after the trigger (excluding the trigger itself). */
  partial: string;
  /** Suggestions returned by the active provider. Empty array hides the picker. */
  completions: MentionCompletion[];
  /**
   * Cursor offset where the trigger sits in the input. Lets the host replace
   * `[triggerStart, cursor)` when the user accepts a completion.
   */
  triggerStart: number;
  /** 0-based index of the currently highlighted completion. */
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
}

type BaseState = Omit<MentionPickerState, 'setSelectedIndex' | 'selectedIndex'>;

const EMPTY: BaseState = {
  trigger: null,
  partial: '',
  completions: [],
  triggerStart: -1,
};

interface DetectResult {
  trigger: string;
  start: number;
}

/**
 * Detect a `<trigger><partial>` token at the cursor. Triggers are
 * single-character (e.g. `@`) and the partial is anything up to the next
 * whitespace before the cursor. Returns `null` when no trigger is active.
 *
 * Triggers must follow whitespace (or beginning of input) so they don't match
 * inside email addresses.
 */
function detectTrigger(value: string, cursor: number, triggers: Set<string>): DetectResult | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = value[i];
    if (/\s/.test(ch)) return null;
    if (triggers.has(ch)) {
      const prev = i === 0 ? ' ' : value[i - 1];
      if (!/\s/.test(prev)) return null;
      return { trigger: ch, start: i };
    }
  }
  return null;
}

/**
 * Watch the input and resolve plugin-provided mention completions. Keeps the
 * provider list in sync with `registry.onMentionProvidersChange`.
 */
export function useMentionPicker(registry: PluginRegistry, value: string, cursor: number): MentionPickerState {
  const [providers, setProviders] = useState(() => registry.getMentionProviders());
  const [base, setBase] = useState<BaseState>(EMPTY);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setProviders(registry.getMentionProviders());
    return registry.onMentionProvidersChange(() => setProviders(registry.getMentionProviders()));
  }, [registry]);

  useEffect(() => {
    if (providers.length === 0) {
      setBase(EMPTY);
      return;
    }
    const triggers = new Set(providers.map((p) => p.trigger));
    const match = detectTrigger(value, cursor, triggers);
    if (!match) {
      setBase(EMPTY);
      return;
    }
    const partial = value.slice(match.start + 1, cursor);
    const provider = providers.find((p) => p.trigger === match.trigger);
    if (!provider) {
      setBase(EMPTY);
      return;
    }
    let cancelled = false;
    Promise.resolve(provider.provider(partial))
      .then((completions) => {
        if (cancelled) return;
        setBase({
          trigger: match.trigger,
          partial,
          completions,
          triggerStart: match.start,
        });
      })
      .catch(() => {
        if (!cancelled) setBase(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [providers, value, cursor]);

  // Reset highlight whenever the active partial / completion list changes so
  // the cursor tracks the visible options. Depending on `completions.length`
  // (rather than the array reference) keeps the highlight stable when the
  // provider returns equivalent results twice while still re-anchoring on a
  // genuine list change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger reset is intentional
  useEffect(() => {
    setSelectedIndex(0);
  }, [base.partial, base.completions.length, base.trigger]);

  const setIndex = useCallback((i: number) => {
    setSelectedIndex(i);
  }, []);

  return { ...base, selectedIndex, setSelectedIndex: setIndex };
}
