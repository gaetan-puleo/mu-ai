import { Box } from 'ink';
import TextInput from 'ink-text-input';
import React from 'react';

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  /** Color used for the top and bottom borders. Defaults to a dim grey. */
  borderColor?: string;
  /** When false, the input ignores keystrokes (used while another overlay owns the keyboard). */
  focus?: boolean;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  borderColor = 'gray',
  focus = true,
}: PromptInputProps): React.ReactElement {
  return (
    <Box
      flexShrink={0}
      width="100%"
      borderStyle="single"
      borderLeft={false}
      borderRight={false}
      borderColor={borderColor}
      paddingX={1}
    >
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        focus={focus}
      />
    </Box>
  );
}
