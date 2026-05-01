import { InputBoxView } from './InputBoxView';
import { type InputBoxProps, useInputBox } from './useInputBox';

export function InputBox(props: InputBoxProps) {
  return <InputBoxView {...useInputBox(props)} />;
}
