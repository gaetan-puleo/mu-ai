import { Box, Text } from 'ink';
import { useState } from 'react';
import { useDispatch } from '../../state/AppContext';
import { useChordKeyboard } from '../../hooks/useChordKeyboard';
import { useTheme } from '../../theme/ThemeContext';
import { Modal } from '../primitives/modal';

export interface ModelPickerModalProps {
  models: string[];
  current?: string;
  onSelect: (model: string) => void;
}

const WINDOW = 10;

export function ModelPickerModal({ models, current, onSelect }: ModelPickerModalProps) {
  const theme = useTheme();
  const dispatch = useDispatch();
  const [idx, setIdx] = useState(() => (current ? Math.max(0, models.indexOf(current)) : 0));

  useChordKeyboard({
    onArrowUp: () => setIdx((i) => Math.max(0, i - 1)),
    onArrowDown: () => setIdx((i) => Math.min(models.length - 1, i + 1)),
    onEnter: () => {
      const sel = models[idx];
      if (sel) onSelect(sel);
    },
    onEscape: () => {
      dispatch({ type: 'modal_close' });
    },
  });

  // Scroll the WINDOW around `idx` so the highlighted entry is always
  // rendered. Without this, the previous `models.slice(0, 10)` let users
  // navigate (and select) hidden entries.
  const start = Math.max(0, Math.min(idx - Math.floor(WINDOW / 2), models.length - WINDOW));
  const visible = models.slice(Math.max(0, start), Math.max(0, start) + WINDOW);
  const hiddenBefore = Math.max(0, start);
  const hiddenAfter = Math.max(0, models.length - (hiddenBefore + visible.length));

  return (
    <Modal
      title={`Models (${models.length})`}
      width={60}
      footer="↑↓ select  ⏎ confirm  esc cancel"
    >
      {models.length === 0 ? (
        <Text dimColor>(no models available — check baseUrl / server)</Text>
      ) : (
        <>
          {hiddenBefore > 0 ? <Text dimColor>  ↑ {hiddenBefore} more</Text> : null}
          {visible.map((m, i) => {
            const absolute = hiddenBefore + i;
            const active = absolute === idx;
            return (
              <Box key={m} flexDirection="row">
                <Text color={active ? theme.colors.selection : undefined} bold={active}>
                  {active ? '▸ ' : '  '}
                  {m}
                </Text>
                {m === current ? <Text dimColor> (current)</Text> : null}
              </Box>
            );
          })}
          {hiddenAfter > 0 ? <Text dimColor>  ↓ {hiddenAfter} more</Text> : null}
        </>
      )}
    </Modal>
  );
}
