import { useDispatch } from '../../state/AppContext';
import { Dropdown } from '../primitives/dropdown';
import { Modal } from '../primitives/modal';

export interface SelectModalProps {
  title: string;
  options: string[];
  placeholder?: string;
  resolve: (value: string | null) => void;
}

/**
 * Filterable single-choice modal. Wraps the `Dropdown` primitive so the
 * filter-as-you-type UX from the old DialogLayer comes back.
 */
export function SelectModal({ title, options, placeholder, resolve }: SelectModalProps) {
  const dispatch = useDispatch();
  const items = options.map((opt) => ({ label: opt, value: opt }));
  const close = (value: string | null): void => {
    resolve(value);
    dispatch({ type: 'modal_close' });
  };
  return (
    <Modal title={title}>
      <Dropdown
        items={items}
        placeholder={placeholder ?? 'Filter...'}
        onSelect={(item) => close(item.value)}
        onCancel={() => close(null)}
      />
    </Modal>
  );
}
