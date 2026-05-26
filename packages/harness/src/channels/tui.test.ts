import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createTuiChannel, lineSourceFrom } from './tui';
import type { ChannelInEvent } from './types';

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

describe('createTuiChannel', () => {
  it('dispatches a slash-prefixed line as a command', async () => {
    const inputs: ChannelInEvent[] = [];
    const out: string[] = [];
    const channel = createTuiChannel({
      input: lineSourceFrom(['/help']),
      output: (chunk) => out.push(chunk),
      noColor: true,
    });
    channel.start({
      channelId: 'tui',
      deliver: (ev) => {
        inputs.push(ev);
      },
    });
    await flush();
    expect(inputs).toEqual([{ type: 'command', input: '/help' }]);
    channel.stop();
  });

  it('dispatches a plain line as user_input', async () => {
    const inputs: ChannelInEvent[] = [];
    const channel = createTuiChannel({
      input: lineSourceFrom(['hello']),
      output: () => {},
      noColor: true,
    });
    channel.start({
      channelId: 'tui',
      deliver: (ev) => {
        inputs.push(ev);
      },
    });
    await flush();
    expect(inputs).toEqual([{ type: 'user_input', text: 'hello' }]);
    channel.stop();
  });

  it('writes assistant deltas verbatim', () => {
    const out: string[] = [];
    const channel = createTuiChannel({ output: (chunk) => out.push(chunk), noColor: true });
    channel.start({ channelId: 'tui', deliver: () => {} });
    channel.send({ type: 'assistant_delta', content: 'Hello' });
    channel.send({ type: 'assistant_delta', content: ', world' });
    channel.stop();
    expect(out.join('')).toContain('Hello, world');
  });

  it('renders errors with the message text', () => {
    const out: string[] = [];
    const channel = createTuiChannel({ output: (chunk) => out.push(chunk), noColor: true });
    channel.start({ channelId: 'tui', deliver: () => {} });
    channel.send({ type: 'error', error: new Error('boom') });
    channel.stop();
    expect(out.join('')).toContain('boom');
  });
});
