import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import type { DialogRequest, InkUIService } from '../../services/uiService';
import { Dropdown } from './dropdown';
import { Modal } from './modal';

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
        <Text color={selected === 0 ? 'green' : undefined} bold={selected === 0}>
          {selected === 0 ? '▸ ' : '  '}Yes
        </Text>
        <Text color={selected === 1 ? 'red' : undefined} bold={selected === 1}>
          {selected === 1 ? '▸ ' : '  '}No
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor={true}>y/n · Enter to confirm · Esc to cancel</Text>
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

function InputDialog({
  dialog,
  onResolve,
  onCancel,
}: {
  dialog: DialogRequest;
  onResolve: (value: unknown) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      onResolve(value || null);
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (input && input.length === 1) {
      setValue((v) => v + input);
    }
  });

  return (
    <Modal visible={true} title={dialog.title}>
      <Box flexDirection="column">
        <Box paddingX={1} marginBottom={1}>
          {!value && dialog.placeholder && <Text dimColor={true}>{dialog.placeholder}</Text>}
          {value && <Text>{value}</Text>}
          <Text inverse={true}>▎</Text>
        </Box>
        <Box>
          <Text dimColor={true}>Enter to submit · Esc to cancel</Text>
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
