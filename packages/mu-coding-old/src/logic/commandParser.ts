export type ParsedInput =
  | { type: 'command'; name: string; args: string }
  | { type: 'shell'; cmd: string }
  | { type: 'message'; text: string }
  | { type: 'empty' };

export function parseInput(raw: string): ParsedInput {
  const text = raw.trim();
  if (!text) return { type: 'empty' };

  if (text.startsWith('!')) {
    const cmd = text.slice(1).trim();
    if (!cmd) return { type: 'empty' };
    return { type: 'shell', cmd };
  }

  if (text.startsWith('/')) {
    const trimmed = text.slice(1);
    const spaceIdx = trimmed.search(/\s/);
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
    if (!name) return { type: 'empty' };
    return { type: 'command', name, args };
  }

  return { type: 'message', text };
}
