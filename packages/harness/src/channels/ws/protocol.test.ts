import { expect, test } from 'vitest';
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

test('parseInbound: chat / abort', () => {
  expect(ok({ type: 'chat', text: 'hi', sessionId: 's1' })).toEqual({ type: 'chat', text: 'hi', sessionId: 's1' });
  expect(ok({ type: 'abort', sessionId: 's1' })).toEqual({ type: 'abort', sessionId: 's1' });
  expect(err({ type: 'abort' }).includes('abort')).toEqual(true);
});

test('parseInbound: models list/select', () => {
  expect(ok({ type: 'models:list' })).toEqual({ type: 'models:list' });
  expect(ok({ type: 'models:select', ref: 'local/x' })).toEqual({ type: 'models:select', ref: 'local/x' });
  expect(err({ type: 'models:select' }).includes('ref')).toEqual(true);
});

test('parseInbound: subagent:dispatch requires requestId/agent/task', () => {
  expect(ok({ type: 'subagent:dispatch', requestId: 'r1', agent: 'researcher', task: 'go', parentId: 'p1' })).toEqual({ type: 'subagent:dispatch', requestId: 'r1', agent: 'researcher', task: 'go', parentId: 'p1' });
  expect(ok({ type: 'subagent:dispatch', requestId: 'r1', agent: 'a', task: 't' }).type).toEqual('subagent:dispatch');
  expect(err({ type: 'subagent:dispatch', agent: 'a', task: 't' }).includes('requestId')).toEqual(true);
});

test('parseInbound: sessions:fork requires requestId + int upToIndex', () => {
  expect(ok({ type: 'sessions:fork', requestId: 'r1', sessionId: 's1', upToIndex: 3 })).toEqual({ type: 'sessions:fork', requestId: 'r1', sessionId: 's1', upToIndex: 3 });
  expect(err({ type: 'sessions:fork', sessionId: 's1', upToIndex: 3 }).includes('requestId')).toEqual(true);
  expect(err({ type: 'sessions:fork', requestId: 'r1', sessionId: 's1', upToIndex: -1 }).includes('upToIndex')).toEqual(true);
});

test('parseInbound: unknown type is an error', () => {
  expect(err({ type: 'nope' }).includes('unknown message type')).toEqual(true);
  expect(err(null).includes('not an object')).toEqual(true);
});

test('parseInbound: voice check/transcribe', () => {
  expect(ok({ type: 'voice:check', requestId: 'r1' })).toEqual({ type: 'voice:check', requestId: 'r1' });
  expect(err({ type: 'voice:check' }).includes('requestId')).toEqual(true);
  expect(ok({ type: 'voice:transcribe', requestId: 'r1', mime: 'audio/wav', data: 'AAA=' })).toEqual({ type: 'voice:transcribe', requestId: 'r1', mime: 'audio/wav', data: 'AAA=' });
  expect(err({ type: 'voice:transcribe', requestId: 'r1', mime: 'audio/wav' }).includes('data')).toEqual(true);
  expect(err({ type: 'voice:transcribe', requestId: 'r1', data: 'AAA=' }).includes('mime')).toEqual(true);
});
