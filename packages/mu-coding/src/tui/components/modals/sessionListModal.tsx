import { Box, Text } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { useDispatch } from '../../state/AppContext';
import { useChordKeyboard } from '../../hooks/useChordKeyboard';
import { useTheme } from '../../theme/ThemeContext';
import { Modal } from '../primitives/modal';
import type { SessionSummary } from '../../../store';

export interface SessionListModalProps {
  sessions: SessionSummary[];
  onSelect: (id: string) => void;
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

export function SessionListModal({ sessions, onSelect }: SessionListModalProps) {
  const theme = useTheme();
  const dispatch = useDispatch();
  const [idx, setIdx] = useState(0);

  const items = useMemo(() => sessions, [sessions]);

  useEffect(() => {
    if (idx >= items.length) setIdx(Math.max(0, items.length - 1));
  }, [idx, items.length]);

  useChordKeyboard({
    onArrowUp: () => {
      setIdx((i) => Math.max(0, i - 1));
    },
    onArrowDown: () => {
      setIdx((i) => Math.min(items.length - 1, i + 1));
    },
    onEnter: () => {
      const sel = items[idx];
      if (sel) onSelect(sel.id);
    },
    onEscape: () => {
      dispatch({ type: 'modal_close' });
    },
  });

  return (
    <Modal title="Sessions" width={70} footer="↑↓ select  ⏎ open  esc close">
      {items.length === 0 ? (
        <Text dimColor>(no sessions)</Text>
      ) : (
        items.slice(0, 10).map((s, i) => {
          const active = i === idx;
          return (
            <Box key={s.id} flexDirection="row">
              <Text color={active ? theme.colors.selection : undefined} bold={active}>
                {active ? '▸ ' : '  '}
                {s.id}
              </Text>
              <Text dimColor> · {fmtDate(s.updatedAt)} · {s.messageCount}msg</Text>
            </Box>
          );
        })
      )}
    </Modal>
  );
}
