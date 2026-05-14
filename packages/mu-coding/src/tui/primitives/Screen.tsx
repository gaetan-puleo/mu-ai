import { Box, useWindowSize } from 'ink';
import React from 'react';

export interface ScreenProps {
  children: React.ReactNode;
}

export function Screen({ children }: ScreenProps): React.ReactElement {
  const { rows, columns } = useWindowSize();
  return (
    <Box flexDirection="column" height={rows} width={columns}>
      {children}
    </Box>
  );
}
