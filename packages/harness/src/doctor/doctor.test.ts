import { createServer } from 'node:net';
import { expect, test } from 'vitest';
import { fail, formatReport, info, ok, runChecks, warn } from './check';
import type { Check } from './check';
import { commandAvailable, tcpProbe } from './probes';

test('check helpers carry level/title/detail', () => {
  expect(ok('up', 'all good')).toEqual({ level: 'ok', title: 'up', detail: 'all good' });
  expect(warn('slow')).toEqual({ level: 'warn', title: 'slow', detail: undefined });
  expect(fail('down', 'no route')).toEqual({ level: 'fail', title: 'down', detail: 'no route' });
  expect(info('note')).toEqual({ level: 'info', title: 'note', detail: undefined });
});

test('runChecks aggregates, flattens arrays, and awaits async checks', async () => {
  const checks: Check[] = [
    () => ok('sync'),
    () => [ok('a'), info('b')],
    async () => warn('async'),
  ];
  const report = await runChecks(checks);
  expect(report.results.map((r) => r.title)).toEqual(['sync', 'a', 'b', 'async']);
  expect(report.ok).toBe(true);
});

test('runChecks sets ok=false when any fail is present', async () => {
  const report = await runChecks([() => ok('a'), () => fail('boom')]);
  expect(report.ok).toBe(false);
});

test('runChecks turns a throwing check into a fail result', async () => {
  const report = await runChecks([
    () => {
      throw new Error('kaboom');
    },
  ]);
  expect(report.ok).toBe(false);
  expect(report.results).toEqual([{ level: 'fail', title: 'check threw', detail: 'kaboom' }]);
});

test('formatReport renders a symbol per level', () => {
  const out = formatReport({
    ok: false,
    results: [ok('o'), warn('w'), fail('f', 'why'), info('i')],
  });
  const lines = out.split('\n');
  expect(lines[0]).toBe('✓ o');
  expect(lines[1]).toBe('⚠ w');
  expect(lines[2]).toBe('✗ f — why');
  expect(lines[3]).toBe('→ i');
});

test('tcpProbe is true for a live listener and false otherwise', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('expected a TCP address');
  const port = addr.port;

  expect(await tcpProbe('127.0.0.1', port)).toBe(true);

  await new Promise<void>((resolve) => server.close(() => resolve()));

  // Same port, now with no listener.
  expect(await tcpProbe('127.0.0.1', port)).toBe(false);
});

test('commandAvailable resolves true for node and false for a bogus command', async () => {
  expect(await commandAvailable('node')).toBe(true);
  expect(await commandAvailable('definitely-not-a-real-binary-xyz')).toBe(false);
});
