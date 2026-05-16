import { Box, Text, useInput } from 'ink';
import React from 'react';

const { useState } = React;

export interface DropdownItem<T = string> {
  /** Stable identifier for React key + comparison. */
  id: string;
  /** Text displayed in the list. */
  label: string;
  /** Optional payload returned by `onSelect`. Defaults to `id`. */
  value?: T;
}

export interface DropdownProps<T = string> {
  /** List of items to pick from. */
  items: readonly DropdownItem<T>[];
  /** Called with the item's `value` (or `id` if no value) when the user confirms. */
  onSelect: (value: T, item: DropdownItem<T>) => void;
  /** Optional cancel handler (esc / q). */
  onCancel?: () => void;
  /** Optional heading rendered above the list. */
  title?: string;
  /** Index of the initially highlighted item. Clamped to valid range. */
  initialIndex?: number;
  /** Glyph rendered before the highlighted row. Defaults to '› '. */
  cursorPrefix?: string;
  /** Glyph rendered before non-highlighted rows (same width as cursorPrefix). Defaults to '  '. */
  itemPrefix?: string;
  /** Color of the highlighted row text + cursor. */
  highlightColor?: string;
  /** Maximum number of items visible at once. When exceeded, the viewport scrolls to follow the cursor. */
  maxVisible?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function Dropdown<T = string>({
  items,
  onSelect,
  onCancel,
  title,
  initialIndex = 0,
  cursorPrefix = '› ',
  itemPrefix = '  ',
  highlightColor = 'cyan',
  maxVisible,
}: DropdownProps<T>): React.ReactElement {
  const [cursor, setCursor] = useState(() => clamp(initialIndex, 0, Math.max(0, items.length - 1)));

  useInput((input, key) => {
    if (items.length === 0) {
      if (key.escape || input === 'q') onCancel?.();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c - 1 + items.length) % items.length);
    } else if (key.downArrow) {
      setCursor((c) => (c + 1) % items.length);
    } else if (key.return) {
      const item = items[cursor];
      if (item) {
        const value = (item.value ?? (item.id as unknown as T)) as T;
        onSelect(value, item);
      }
    } else if (key.escape || input === 'q') {
      onCancel?.();
    }
  });

  if (items.length === 0) {
    return (
      <Box flexDirection="column">
        {title ? <Text bold={true}>{title}</Text> : null}
        <Text dimColor={true}>(no items)</Text>
      </Box>
    );
  }

  // Compute the visible window of items so long lists don't blow the viewport.
  let start = 0;
  let end = items.length;
  if (maxVisible && maxVisible > 0 && items.length > maxVisible) {
    const half = Math.floor(maxVisible / 2);
    start = clamp(cursor - half, 0, items.length - maxVisible);
    end = start + maxVisible;
  }

  return (
    <Box flexDirection="column">
      {title ? <Text bold={true}>{title}</Text> : null}
      {items.slice(start, end).map((item, i) => {
        const absolute = start + i;
        const isCursor = absolute === cursor;
        return (
          <Text key={item.id} color={isCursor ? highlightColor : undefined}>
            {isCursor ? cursorPrefix : itemPrefix}
            {item.label}
          </Text>
        );
      })}
    </Box>
  );
}
