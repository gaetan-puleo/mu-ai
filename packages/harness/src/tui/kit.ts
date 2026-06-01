import { column, type Component, editor, type FlexItem, scrollView, text } from 'mu-tui';

export interface EditorHandle extends Component {
  getValue(): string;
  setValue(value: string): void;
}

export interface ComponentKit {
  text(value: string): Component;
  column(children: (Component | FlexItem)[]): Component;
  scrollView(content: Component): Component;
  editor(opts: { placeholder?: string; onSubmit?: (value: string) => void }): EditorHandle;
}

export const defaultKit: ComponentKit = {
  text,
  column,
  scrollView,
  editor,
};
