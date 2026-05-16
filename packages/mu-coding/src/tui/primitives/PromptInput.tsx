import type { Key } from 'ink';
import { Box, useInput } from 'ink';
import { MultilineInput } from 'ink-multiline-input';
import React from 'react';

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onKey?: (input: string, key: Key) => boolean | undefined;
  focus?: boolean;
  placeholder?: string;
  dropdown?: React.ReactNode;
  paletteActive?: boolean;
}

const PromptInputKeyContext = React.createContext<PromptInputProps['onKey']>(undefined);

function usePromptInput(inputHandler: (input: string, key: Key) => void, isActive: boolean): void {
  const onKey = React.useContext(PromptInputKeyContext);
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'j') {
        const normalizedKey = { ...key, return: true };
        if (onKey?.('', normalizedKey) !== true) inputHandler('', normalizedKey);
        return;
      }
      if (onKey?.(input, key) === true) return;
      inputHandler(input, key);
    },
    { isActive },
  );
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  onKey,
  focus = true,
  placeholder,
  dropdown,
  paletteActive = false,
}: PromptInputProps): React.ReactElement {
  return (
    <Box flexShrink={0} flexDirection="column" width="100%">
      {dropdown ? <Box flexShrink={0}>{dropdown}</Box> : null}
      <Box flexShrink={0} width="100%" backgroundColor="#1a1a1a" paddingX={1} paddingY={1}>
        <PromptInputKeyContext.Provider value={onKey}>
          <MultilineInput
            focus={focus}
            value={value}
            onChange={onChange}
            onSubmit={paletteActive ? undefined : onSubmit}
            placeholder={placeholder ?? ''}
            rows={1}
            maxRows={8}
            showCursor={true}
            useCustomInput={usePromptInput}
            keyBindings={{
              submit: (key) => key.return && !(key.shift || key.ctrl || key.meta),
              newline: (key) => key.return && (key.shift || key.ctrl || key.meta),
            }}
          />
        </PromptInputKeyContext.Provider>
      </Box>
    </Box>
  );
}
