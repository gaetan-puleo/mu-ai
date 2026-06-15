import { assertEquals } from '@std/assert';
import { parseInbound, type WsInbound } from './protocol';

const ok = (raw: unknown): WsInbound => {
  const result = parseInbound(raw);
  if ('error' in result) throw new Error(`expected ok, got error: ${result.error}`);
  return result;
};

const err = (raw: unknown): string => {
  const result = parseInbound(raw);
  if (!('error' in result)) throw new Error('expected error, got ok');
  return result.error;
};

Deno.test('parseInbound: chat / abort', () => {
  assertEquals(ok({ type: 'chat', text: 'hi', sessionId: 's1' }), { type: 'chat', text: 'hi', sessionId: 's1' });
  assertEquals(ok({ type: 'abort', sessionId: 's1' }), { type: 'abort', sessionId: 's1' });
  assertEquals(err({ type: 'abort' }).includes('abort'), true);
});

Deno.test('parseInbound: models list/select', () => {
  assertEquals(ok({ type: 'models:list' }), { type: 'models:list' });
  assertEquals(ok({ type: 'models:select', ref: 'local/x' }), { type: 'models:select', ref: 'local/x' });
  assertEquals(err({ type: 'models:select' }).includes('ref'), true);
});

Deno.test('parseInbound: subagent:dispatch requires requestId/agent/task', () => {
  assertEquals(
    ok({ type: 'subagent:dispatch', requestId: 'r1', agent: 'researcher', task: 'go', parentId: 'p1' }),
    { type: 'subagent:dispatch', requestId: 'r1', agent: 'researcher', task: 'go', parentId: 'p1' },
  );
  assertEquals(ok({ type: 'subagent:dispatch', requestId: 'r1', agent: 'a', task: 't' }).type, 'subagent:dispatch');
  assertEquals(err({ type: 'subagent:dispatch', agent: 'a', task: 't' }).includes('requestId'), true);
});

Deno.test('parseInbound: sessions:fork requires requestId + int upToIndex', () => {
  assertEquals(
    ok({ type: 'sessions:fork', requestId: 'r1', sessionId: 's1', upToIndex: 3 }),
    { type: 'sessions:fork', requestId: 'r1', sessionId: 's1', upToIndex: 3 },
  );
  assertEquals(err({ type: 'sessions:fork', sessionId: 's1', upToIndex: 3 }).includes('requestId'), true);
  assertEquals(
    err({ type: 'sessions:fork', requestId: 'r1', sessionId: 's1', upToIndex: -1 }).includes('upToIndex'),
    true,
  );
});

Deno.test('parseInbound: unknown type is an error', () => {
  assertEquals(err({ type: 'nope' }).includes('unknown message type'), true);
  assertEquals(err(null).includes('not an object'), true);
});

Deno.test('parseInbound: voice check/transcribe', () => {
  assertEquals(ok({ type: 'voice:check', requestId: 'r1' }), { type: 'voice:check', requestId: 'r1' });
  assertEquals(err({ type: 'voice:check' }).includes('requestId'), true);
  assertEquals(
    ok({ type: 'voice:transcribe', requestId: 'r1', mime: 'audio/wav', data: 'AAA=' }),
    { type: 'voice:transcribe', requestId: 'r1', mime: 'audio/wav', data: 'AAA=' },
  );
  assertEquals(err({ type: 'voice:transcribe', requestId: 'r1', mime: 'audio/wav' }).includes('data'), true);
  assertEquals(err({ type: 'voice:transcribe', requestId: 'r1', data: 'AAA=' }).includes('mime'), true);
});
