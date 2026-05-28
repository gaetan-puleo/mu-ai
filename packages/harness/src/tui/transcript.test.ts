import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { TranscriptModel } from './transcript';

describe('TranscriptModel', () => {
  it('records a user/assistant exchange', () => {
    const t = new TranscriptModel();
    t.apply({ type: 'user_message', message: { role: 'user', content: 'hi' } });
    t.apply({ type: 'assistant_message', message: { role: 'assistant', content: 'hello' } });
    expect(t.lines).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('streams assistant deltas into a single line', () => {
    const t = new TranscriptModel();
    t.apply({ type: 'assistant_delta', content: 'hel' });
    t.apply({ type: 'assistant_delta', content: 'lo' });
    expect(t.lines).toEqual([{ role: 'assistant', content: 'hello' }]);
  });

  it('inserts reasoning above the pending assistant line', () => {
    const t = new TranscriptModel({ thinkingVisible: true });
    t.apply({ type: 'assistant_delta', content: 'reply' });
    t.apply({ type: 'reasoning_delta', content: 'think' });
    expect(t.lines).toEqual([
      { role: 'reasoning', content: 'think', closed: false },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('formats tool args via injected formatter', () => {
    const t = new TranscriptModel({
      formatToolCallArgs: (name, args) => `${name}(${args})`,
    });
    t.apply({ type: 'tool_call', call: { id: 'c1', name: 'read', args: '{"path":"x"}' } });
    expect(t.lines).toEqual([
      { role: 'tool', callId: 'c1', name: 'read', argsPreview: 'read({"path":"x"})' },
    ]);
  });

  it('toggles thinking visibility on every reasoning line', () => {
    const t = new TranscriptModel();
    t.apply({ type: 'reasoning_message', content: 'a' });
    t.apply({ type: 'reasoning_message', content: 'b' });
    expect(t.lines.every((l) => 'role' in l && l.role === 'reasoning' ? l.closed === false : true)).toBe(true);
    t.toggleThinking();
    expect(t.lines.every((l) => 'role' in l && l.role === 'reasoning' ? l.closed === true : true)).toBe(true);
  });

  it('supports agent-specific lines via the Extra generic', () => {
    type ExtraLine = { role: 'embed'; runId: string };
    const t = new TranscriptModel<ExtraLine>();
    t.lines.push({ role: 'embed', runId: 'r1' });
    t.apply({ type: 'user_message', message: { role: 'user', content: 'hi' } });
    expect(t.lines).toEqual([
      { role: 'embed', runId: 'r1' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('labels queued lines with the configured prefix', () => {
    const t = new TranscriptModel({ steeringLabel: 'queued', followUpLabel: 'follow' });
    t.appendQueuedMessage({ role: 'user', content: 'a' }, 'steering');
    t.appendQueuedMessage({ role: 'user', content: 'b' }, 'follow_up');
    expect(t.lines).toEqual([
      { role: 'user', content: 'a', label: 'queued' },
      { role: 'user', content: 'b', label: 'follow' },
    ]);
  });

  it('clears the queued label when the message becomes active', () => {
    const t = new TranscriptModel();
    t.appendQueuedMessage({ role: 'user', content: 'a' }, 'steering');
    t.activateNextQueuedUserMessage();
    expect(t.lines).toEqual([{ role: 'user', content: 'a' }]);
  });

  it('returns false from apply() for unhandled event types', () => {
    const t = new TranscriptModel();
    const handled = t.apply({
      type: 'tool_result',
      message: { role: 'tool', content: 'ok', tool_id: 'c1' },
    });
    expect(handled).toBe(false);
  });

  it('activates the queued user line on the first turn-start event', () => {
    const t = new TranscriptModel();
    t.appendQueuedMessage({ role: 'user', content: 'q' }, 'steering');
    // While queued, the line carries a label.
    expect(t.lines[0]).toEqual({ role: 'user', content: 'q', label: 'queued steering' });
    // assistant_start should un-fade.
    t.apply({ type: 'assistant_start' });
    expect(t.lines[0]).toEqual({ role: 'user', content: 'q' });
  });

  it('resets pending state without dropping past lines', () => {
    const t = new TranscriptModel();
    t.apply({ type: 'user_message', message: { role: 'user', content: 'hi' } });
    t.apply({ type: 'assistant_delta', content: 'partial' });
    t.resetPending();
    t.apply({ type: 'assistant_delta', content: 'fresh' });
    expect(t.lines).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'partial' },
      { role: 'assistant', content: 'fresh' },
    ]);
  });
});
