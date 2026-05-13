import { Box, Text } from 'ink';
import { useTheme } from '../../theme/ThemeContext';
import { Modal } from './modal';

export interface PickerItem {
  value: string;
  label: string;
  description?: string;
}

export interface PickerModalProps {
  title: string;
  items: PickerItem[];
  selectedIndex: number;
  emptyMessage?: string;
  footer?: string;
  width?: number;
}

const MAX_VISIBLE = 8;

export function PickerModal({
  title,
  items,
  selectedIndex,
  emptyMessage = '(no matches)',
  footer = '↑↓ select  ⏎ confirm  esc cancel',
  width,
}: PickerModalProps) {
  const theme = useTheme();
  // Window items around the selection so long lists scroll.
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(MAX_VISIBLE / 2), items.length - MAX_VISIBLE));
  const visible = items.slice(start, start + MAX_VISIBLE);

  return (
    <Modal title={title} width={width ?? 60} footer={footer}>
      {items.length === 0 ? (
        <Text dimColor>{emptyMessage}</Text>
      ) : (
        visible.map((item, idx) => {
          const realIdx = start + idx;
          const active = realIdx === selectedIndex;
          return (
            // `wrap="truncate-end"` prevents long descriptions from pushing
            // the label onto a second row and visually clipping it (e.g.
            // `/model` rendering as `/mode` when the row wrapped).
            <Box key={item.value} flexDirection="row">
              <Text color={active ? theme.colors.selection : undefined} bold={active} wrap="truncate-end">
                {active ? '▸ ' : '  '}
                {item.label}
                {item.description ? <Text dimColor> — {item.description}</Text> : null}
              </Text>
            </Box>
          );
        })
      )}
    </Modal>
  );
}
