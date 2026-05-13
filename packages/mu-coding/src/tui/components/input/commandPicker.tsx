import type { Command } from 'mu-core';
import { useMemo } from 'react';
import { PickerModal, type PickerItem } from '../primitives/pickerModal';

export interface CommandPickerProps {
  partial: string;
  selectedIndex: number;
  commands: readonly Command[];
}

export function filterCommands(partial: string, commands: readonly Command[]): Command[] {
  if (!partial) return [...commands];
  const lower = partial.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(lower));
}

export function CommandPicker({ partial, selectedIndex, commands }: CommandPickerProps) {
  const items = useMemo<PickerItem[]>(() => {
    return filterCommands(partial, commands).map((c) => ({
      value: c.name,
      label: `/${c.name}`,
      description: c.description,
    }));
  }, [partial, commands]);

  return <PickerModal title="Commands" items={items} selectedIndex={selectedIndex} />;
}
