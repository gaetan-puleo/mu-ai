import { Text } from 'ink';
import { useTheme } from '../../context/ThemeContext';
import { Dropdown } from './dropdown';
import { Modal } from './modal';

interface PickerItem {
  label: string;
  value: string;
  description?: string;
}

export function PickerModal({
  visible,
  title,
  items,
  placeholder,
  emptyMessage,
  onSelect,
  onCancel,
}: {
  visible: boolean;
  title: string;
  items: PickerItem[];
  placeholder: string;
  emptyMessage?: string;
  onSelect: (value: string) => void;
  onCancel?: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} title={title}>
      {items.length === 0 && emptyMessage ? (
        <Text color={theme.dropdown.empty} italic={true}>
          {emptyMessage}
        </Text>
      ) : (
        <Dropdown
          items={items}
          placeholder={placeholder}
          isActive={visible}
          onSelect={(item) => onSelect(item.value)}
          onCancel={onCancel}
        />
      )}
    </Modal>
  );
}
