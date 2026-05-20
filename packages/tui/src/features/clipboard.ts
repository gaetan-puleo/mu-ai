import { Buffer } from 'node:buffer';

import { capability } from '../capabilities';
import type { TuiFeature } from '../feature';
import { BEL, OSC, ST } from '../protocol';

export interface ClipboardFeatureOptions {
  write: 'deny' | 'ask' | 'allow';
  read?: 'deny' | 'ask' | 'allow';
  maxPayloadBytes?: number;
  terminator?: 'st' | 'bel';
}

export function clipboardFeature(options: ClipboardFeatureOptions): TuiFeature {
  return {
    name: 'clipboard',
    detect() {
      return {
        osc: { clipboard: capability(options.write !== 'deny', 'policy') },
        security: {
          clipboardWrite: options.write,
          clipboardRead: options.read ?? 'deny',
          maxPayloadBytes: options.maxPayloadBytes ?? 256 * 1024,
        },
      };
    },
  };
}

export function createOsc52Sequence(
  text: string,
  options: { target?: 'c' | 'p' | 's'; maxPayloadBytes?: number; terminator?: 'st' | 'bel' } = {},
): string {
  const payload = Buffer.from(text, 'utf8').toString('base64');
  const maxPayloadBytes = options.maxPayloadBytes ?? 256 * 1024;
  if (Buffer.byteLength(payload, 'utf8') > maxPayloadBytes) {
    throw new Error(`OSC 52 payload exceeds ${maxPayloadBytes} bytes`);
  }
  const terminator = options.terminator === 'bel' ? BEL : ST;
  return `${OSC}52;${options.target ?? 'c'};${payload}${terminator}`;
}
