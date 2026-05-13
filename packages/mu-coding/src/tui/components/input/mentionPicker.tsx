import type { AgentsHandle } from 'mu-agents';
import { useMemo } from 'react';
import { PickerModal, type PickerItem } from '../primitives/pickerModal';

export interface MentionPickerProps {
  partial: string;
  selectedIndex: number;
  agents: AgentsHandle | undefined;
}

export function MentionPicker({ partial, selectedIndex, agents }: MentionPickerProps) {
  const items = useMemo<PickerItem[]>(() => {
    if (!agents) return [];
    return agents.getCompletions(partial).map((c) => ({
      value: c.value,
      label: `@${c.value}`,
      description: c.description,
    }));
  }, [partial, agents]);

  return <PickerModal title="Agents" items={items} selectedIndex={selectedIndex} />;
}
