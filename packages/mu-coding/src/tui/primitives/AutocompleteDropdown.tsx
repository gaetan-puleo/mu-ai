import { Box, Text } from 'ink';
import type React from 'react';
import type { DropdownItem } from './Dropdown';

export interface AutocompleteDropdownProps {
  /** Items to display. Empty array suppresses the dropdown entirely (returns null). */
  items: readonly DropdownItem[];
  /** Highlighted index. Clamped externally by the parent — we render whatever we're given. */
  cursor: number;
  /** Soft cap on visible rows; the list windows around the cursor when exceeded. */
  maxVisible?: number;
  /** Optional heading shown at the top of the dropdown. */
  title?: string;
  /** Color of the highlight + cursor glyph. Defaults to 'cyan'. */
  highlightColor?: string;
  /** Background color for the highlighted row. */
  highlightBackgroundColor?: string;
  /**
   * Glyph rendered before the highlighted row. Defaults to '› '. The non-
   * highlighted prefix is rendered with the same visual width so labels
   * stay aligned regardless of which row holds the cursor.
   */
  cursorPrefix?: string;
  /** Glyph rendered before non-highlighted rows. Defaults to '  '. */
  itemPrefix?: string;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function AutocompleteDropdown({
  items,
  cursor,
  maxVisible = 8,
  title,
  highlightColor = 'cyan',
  highlightBackgroundColor = '#263238',
  cursorPrefix = '› ',
  itemPrefix = '  ',
}: AutocompleteDropdownProps): React.ReactElement | null {
  if (items.length === 0) return null;

  let start = 0;
  let end = items.length;
  if (maxVisible > 0 && items.length > maxVisible) {
    const half = Math.floor(maxVisible / 2);
    start = clamp(cursor - half, 0, items.length - maxVisible);
    end = start + maxVisible;
  }

  return (
    <Box flexShrink={0} width="100%" flexDirection="column" backgroundColor="#1a1a1a" paddingX={1}>
      {title ? (
        <Text bold={true} dimColor={true}>
          {title}
        </Text>
      ) : null}
      {items.slice(start, end).map((item, i) => {
        const absolute = start + i;
        const isCursor = absolute === cursor;
        return (
          <Box key={item.id} backgroundColor={isCursor ? highlightBackgroundColor : undefined}>
            <Text color={isCursor ? highlightColor : undefined}>
              {isCursor ? cursorPrefix : itemPrefix}
              {item.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
