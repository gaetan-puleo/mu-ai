import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { sanitizeTerminalInput } from '../../input/sanitize';
import type { DialogRequest, InkUIService } from '../../plugins/InkUIService';
import { Dropdown } from '../primitives/dropdown';
import { Modal } from '../primitives/modal';

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  dialog,
  onResolve,
  onCancel,
}: {
  dialog: DialogRequest;
  onResolve: (value: unknown) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      onResolve(selected === 0);
    } else if (key.leftArrow || input === 'h') {
      setSelected(0);
    } else if (key.rightArrow || input === 'l') {
      setSelected(1);
    } else if (input === 'y' || input === 'Y') {
      onResolve(true);
    } else if (input === 'n' || input === 'N') {
      onResolve(false);
    }
  });

  return (
    <Modal visible={true} title={dialog.title}>
      {dialog.message && (
        <Box marginBottom={1}>
          <Text>{dialog.message}</Text>
        </Box>
      )}
      <Box gap={2}>
        <Text color={selected === 0 ? theme.dialog.confirmYes : undefined} bold={selected === 0}>
          {selected === 0 ? '▸ ' : '  '}Yes
        </Text>
        <Text color={selected === 1 ? theme.dialog.confirmNo : undefined} bold={selected === 1}>
          {selected === 1 ? '▸ ' : '  '}No
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dialog.hint}>y/n · Enter to confirm · Esc to cancel</Text>
      </Box>
    </Modal>
  );
}

// ─── Select Dialog ────────────────────────────────────────────────────────────

function SelectDialog({
  dialog,
  onResolve,
  onCancel,
}: {
  dialog: DialogRequest;
  onResolve: (value: unknown) => void;
  onCancel: () => void;
}) {
  const items = (dialog.options ?? []).map((opt) => ({
    label: opt,
    value: opt,
  }));

  return (
    <Modal visible={true} title={dialog.title}>
      <Dropdown items={items} placeholder="Filter..." onSelect={(item) => onResolve(item.value)} onCancel={onCancel} />
    </Modal>
  );
}

// ─── Input Dialog ─────────────────────────────────────────────────────────────

function sanitizeDialogInput(text: string): string {
  // Strip mouse sequences + control bytes via the shared helper, then drop
  // \t/\n that the shared helper preserves — this dialog is single-line.
  return sanitizeTerminalInput(text).replace(/[\t\n]/g, '');
}

function InputDialog({
  dialog,
  onResolve,
  onCancel,
}: {
  dialog: DialogRequest;
  onResolve: (value: unknown) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onResolve(value || null);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    const insert = sanitizeDialogInput(input);
    if (insert) {
      setValue((v) => v + insert);
    }
  });

  return (
    <Modal visible={true} title={dialog.title}>
      <Box flexDirection="column">
        <Box paddingX={1} marginBottom={1}>
          {!value && dialog.placeholder && <Text color={theme.dialog.placeholder}>{dialog.placeholder}</Text>}
          {value && <Text>{value}</Text>}
          <Text color={theme.dialog.cursor} inverse={true}>
            ▎
          </Text>
        </Box>
        <Box>
          <Text color={theme.dialog.hint}>Enter to submit · Esc to cancel</Text>
        </Box>
      </Box>
    </Modal>
  );
}

// ─── Dialog Layer ─────────────────────────────────────────────────────────────

export function DialogLayer({ service }: { service: InkUIService }) {
  const [dialog, setDialog] = useState<DialogRequest | null>(service.currentDialog());

  useEffect(() => {
    return service.subscribe(() => {
      setDialog(service.currentDialog());
    });
  }, [service]);

  const handleResolve = useCallback(
    (value: unknown) => {
      service.resolveDialog(value);
    },
    [service],
  );

  const handleCancel = useCallback(() => {
    service.cancelDialog();
  }, [service]);

  if (!dialog) return null;

  switch (dialog.type) {
    case 'confirm':
      return <ConfirmDialog dialog={dialog} onResolve={handleResolve} onCancel={handleCancel} />;
    case 'select':
      return <SelectDialog dialog={dialog} onResolve={handleResolve} onCancel={handleCancel} />;
    case 'input':
      return <InputDialog dialog={dialog} onResolve={handleResolve} onCancel={handleCancel} />;
    default:
      return null;
  }
}
