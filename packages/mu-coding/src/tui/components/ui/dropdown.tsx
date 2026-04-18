import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';

interface DropdownItem {
  label: string;
  value: string;
  description?: string;
}

function matches(query: string) {
  const q = query.toLowerCase();
  return (item: DropdownItem) =>
    item.label.toLowerCase().includes(q) ||
    item.value.toLowerCase().includes(q) ||
    item.description?.toLowerCase().includes(q);
}

interface DropdownProps {
  items: DropdownItem[];
  placeholder?: string;
  maxVisible?: number;
  onSelect: (item: DropdownItem) => void;
  onCancel?: () => void;
  isActive?: boolean;
}

export function Dropdown({
  items,
  placeholder = 'Search...',
  maxVisible = 8,
  onSelect,
  onCancel,
  isActive = true,
}: DropdownProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const filtered = useMemo(() => (query ? items.filter(matches(query)) : items), [items, query]);

  const visibleStart = Math.max(0, Math.min(index - Math.floor(maxVisible / 2), filtered.length - maxVisible));
  const visibleItems = filtered.slice(visibleStart, visibleStart + maxVisible);

  useInput(
    (input, key) => {
      if (!isActive || key.tab) return;
      if (key.escape) onCancel?.();
      else if (key.return && filtered[index]) onSelect(filtered[index]);
      else if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setIndex((i) => Math.min(filtered.length - 1, i + 1));
      else if (key.backspace) setQuery((q) => q.slice(0, -1));
      else if (input?.length === 1) setQuery((q) => q + input);
    },
    { isActive },
  );

  function renderResults() {
    if (filtered.length === 0) {
      return (
        <Box paddingX={1}>
          <Text dimColor={true} italic={true}>
            No results
          </Text>
        </Box>
      );
    }
    return visibleItems.map((item, i) => {
      const isSel = i === index - visibleStart;
      const color = isSel ? 'green' : undefined;
      return (
        <Box key={item.value} paddingX={1}>
          <Text color={color} bold={isSel}>
            {isSel && '▸ '}
            {item.label}
            {item.description && <Text dimColor={true}> {item.description}</Text>}
          </Text>
        </Box>
      );
    });
  }

  return (
    <Box flexDirection="column">
      <Box paddingX={1} marginBottom={1}>
        <Text dimColor={true}>{placeholder} </Text>
        <Text>{query}</Text>
        <Text inverse={true}>▎</Text>
      </Box>
      {renderResults()}
      {filtered.length > maxVisible && (
        <Box paddingX={1} marginTop={1}>
          <Text dimColor={true}>{filtered.length} items · ↑↓ navigate · Enter select</Text>
        </Box>
      )}
    </Box>
  );
}
