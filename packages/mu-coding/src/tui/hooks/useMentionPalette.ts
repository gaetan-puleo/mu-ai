import type { AgentsHandle } from 'mu-agents';
import React from 'react';
import type { DropdownItem } from '../primitives/Dropdown';

const { useMemo, useState } = React;

export interface MentionPaletteHandle {
  mentionItems: DropdownItem[];
  showMentionPalette: boolean;
  mentionPaletteOpen: boolean;
  mentionCursor: number;
  setMentionCursor: React.Dispatch<React.SetStateAction<number>>;
}

function mentionQuery(input: string): string | null {
  if (!input.startsWith('@')) return null;
  const query = input.slice(1);
  if (/\s/.test(query)) return null;
  return query.toLowerCase();
}

export function useMentionPalette(
  input: string,
  agentsHandle: AgentsHandle | undefined,
  blocked: boolean,
): MentionPaletteHandle {
  const [mentionCursor, setMentionCursor] = useState(0);
  const [prevInput, setPrevInput] = useState(input);

  if (input !== prevInput) {
    setPrevInput(input);
    setMentionCursor(0);
  }

  const query = mentionQuery(input);
  const showMentionPalette = !blocked && agentsHandle !== undefined && query !== null;
  const mentionItems: DropdownItem[] = useMemo(() => {
    if (!(showMentionPalette && agentsHandle)) return [];
    return agentsHandle
      .list()
      .filter((agent) => agent.kind === 'subagent' && agent.name.toLowerCase().startsWith(query ?? ''))
      .map((agent) => ({
        id: `@${agent.name}`,
        label: `@${agent.name}${agent.description ? `  ${agent.description}` : ''}`,
        value: agent.name,
      }));
  }, [agentsHandle, query, showMentionPalette]);

  const mentionPaletteOpen = showMentionPalette && mentionItems.length > 0;
  const effectiveCursor = Math.min(mentionCursor, Math.max(0, mentionItems.length - 1));

  return { mentionItems, showMentionPalette, mentionPaletteOpen, mentionCursor: effectiveCursor, setMentionCursor };
}
