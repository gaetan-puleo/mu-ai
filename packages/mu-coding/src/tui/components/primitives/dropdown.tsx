import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { sanitizeTerminalInput } from '../../utils/sanitize';

export interface DropdownItem {
  label: string;
  value: string;
  description?: string;
}

function matches(query: string) {
  const q = query.toLowerCase();
  return (item: DropdownItem) =>
    item.label.toLowerCase().includes(q) ||
    item.value.toLowerCase().includes(q) ||
    (item.description?.toLowerCase().includes(q) ?? false);
}

export interface DropdownProps {
  items: DropdownItem[];
  placeholder?: string;
  maxVisible?: number;
  onSelect: (item: DropdownItem) => void;
  onCancel?: () => void;
  isActive?: boolean;
}

/**
 * Filter-as-you-type list primitive. Used by SelectModal and any future
 * picker flow that needs incremental filtering. Differs from PickerModal:
 *  - has its own text-input filter (the modal-driving caller doesn't
 *    pre-filter and pass a partial)
 *  - shows a "N items · ↑↓ navigate · Enter select" footer when results
 *    overflow `maxVisible`
 *
 * Hands keyboard input back to the caller via `onSelect` / `onCancel`.
 */
export function Dropdown({
  items,
  placeholder = 'Search...',
  maxVisible = 8,
  onSelect,
  onCancel,
  isActive = true,
}: DropdownProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const filtered = useMemo(() => (query ? items.filter(matches(query)) : items), [items, query]);

  const visibleStart = Math.max(0, Math.min(index - Math.floor(maxVisible / 2), filtered.length - maxVisible));
  const visibleItems = filtered.slice(visibleStart, visibleStart + maxVisible);

  useInput(
    (input, key) => {
      if (!isActive) return;
      // Tab is reserved for the input box's "insert two spaces" binding when
      // dropdowns are not focused; inside a focused dropdown we ignore it
      // rather than risk inserting whitespace into the query.
      if (key.tab) return;
      if (key.escape) {
        onCancel?.();
        return;
      }
      if (key.return && filtered[index]) {
        onSelect(filtered[index]);
        return;
      }
      if (key.upArrow) {
        setIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setIndex((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (key.backspace) {
        setQuery((q) => q.slice(0, -1));
        return;
      }
      // Accept multi-char input (paste) into the filter; strip control bytes
      // and any SGR mouse sequences that may leak through. Single-line: drop \t/\n.
      if (input) {
        const clean = sanitizeTerminalInput(input).replace(/[\t\n]/g, '');
        if (clean) setQuery((q) => q + clean);
      }
    },
    { isActive },
  );

  function renderResults() {
    if (filtered.length === 0) {
      return (
        <Box paddingX={1}>
          <Text color={theme.colors.muted} italic>
            No results
          </Text>
        </Box>
      );
    }
    return visibleItems.map((item, i) => {
      const isSel = i === index - visibleStart;
      const color = isSel ? theme.colors.selection : undefined;
      return (
        <Box key={item.value} paddingX={1}>
          <Text color={color} bold={isSel} wrap="truncate-end">
            {isSel && '▸ '}
            {item.label}
            {item.description ? <Text dimColor> {item.description}</Text> : null}
          </Text>
        </Box>
      );
    });
  }

  return (
    <Box flexDirection="column">
      <Box paddingX={1} marginBottom={1}>
        <Text color={theme.colors.dropdownPlaceholder}>{placeholder} </Text>
        <Text>{query}</Text>
        <Text color={theme.colors.cursor} inverse>
          ▎
        </Text>
      </Box>
      {renderResults()}
      {filtered.length > maxVisible ? (
        <Box paddingX={1} marginTop={1}>
          <Text dimColor>{filtered.length} items · ↑↓ navigate · Enter select</Text>
        </Box>
      ) : null}
    </Box>
  );
}
