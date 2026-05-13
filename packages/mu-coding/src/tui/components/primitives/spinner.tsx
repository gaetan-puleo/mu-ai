import { Text } from 'ink';
import { useEffect, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext';

export function Spinner({ color }: { color?: string }) {
  const theme = useTheme();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % theme.spinner.length), 80);
    return () => clearInterval(id);
  }, [theme.spinner.length]);

  return <Text color={color ?? theme.colors.muted}>{theme.spinner[frame]}</Text>;
}
