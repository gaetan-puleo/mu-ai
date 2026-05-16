import type { ChannelContext, Command } from 'mu-core';
import React from 'react';
import type { DropdownItem } from '../primitives/Dropdown';

const { useMemo, useState } = React;

export interface CommandPaletteHandle {
  commandItems: DropdownItem[];
  showCommandPalette: boolean;
  paletteOpen: boolean;
  paletteCursor: number;
  setPaletteCursor: React.Dispatch<React.SetStateAction<number>>;
}

export function useCommandPalette(input: string, ctx: ChannelContext, blocked: boolean): CommandPaletteHandle {
  const [paletteCursor, setPaletteCursor] = useState(0);
  const [prevInput, setPrevInput] = useState(input);

  if (input !== prevInput) {
    setPrevInput(input);
    setPaletteCursor(0);
  }

  const showCommandPalette = !blocked && input.startsWith('/');
  const commandQuery = input.slice(1).toLowerCase();
  const allCommands: readonly Command[] = showCommandPalette ? ctx.listCommands() : [];
  const commandItems: DropdownItem[] = useMemo(
    () =>
      allCommands
        .filter((c) => c.name.toLowerCase().startsWith(commandQuery))
        .map((c) => ({
          id: `/${c.name}`,
          label: `/${c.name}  ${c.description}`,
        })),
    [allCommands, commandQuery],
  );

  const paletteOpen = showCommandPalette && commandItems.length > 0;
  const effectiveCursor = Math.min(paletteCursor, Math.max(0, commandItems.length - 1));

  return { commandItems, showCommandPalette, paletteOpen, paletteCursor: effectiveCursor, setPaletteCursor };
}
