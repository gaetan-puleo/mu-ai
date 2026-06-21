import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ChannelAdapter } from '../channels/adapter';
import type { Harness } from '../harness/types';
import { createApprovalManager } from '../permissions';
import { serveHost } from './serve-host';
import { watchDefinitions } from './watch';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('serveHost starts adapters and shuts down services → channels → harness in order', async () => {
  const order: string[] = [];
  // Adapter does NOT open a channel, so harness.sessions is never touched.
  const adapter: ChannelAdapter = {
    name: 'fake',
    start: () => {
      order.push('adapter.start');
      return Promise.resolve({
        stop: () => {
          order.push('adapter.stop');
          return Promise.resolve();
        },
      });
    },
  };
  const service = {
    stop: () => {
      order.push('service.stop');
    },
  };
  const harness = {
    close: () => {
      order.push('harness.close');
    },
  } as unknown as Harness;

  const host = await serveHost({
    harness,
    approvals: createApprovalManager(),
    adapters: [adapter],
    services: [service],
  });

  expect(order).toEqual(['adapter.start']);

  await host.shutdown();
  expect(order).toEqual(['adapter.start', 'service.stop', 'adapter.stop', 'harness.close']);

  // Idempotent: a second shutdown runs no teardown again.
  await host.shutdown();
  expect(order).toEqual(['adapter.start', 'service.stop', 'adapter.stop', 'harness.close']);
});

test('watchDefinitions fires a debounced onChange when a file appears', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mu-watch-'));
  let calls = 0;
  const watcher = watchDefinitions({ dirs: [dir], onChange: () => calls++, debounceMs: 50 });

  await writeFile(join(dir, 'agent.md'), 'hello');
  await delay(300);

  expect(calls).toBeGreaterThanOrEqual(1);
  expect(() => watcher.stop()).not.toThrow();
});

test('watchDefinitions ignores non-existent dirs and stop() is safe', () => {
  const watcher = watchDefinitions({ dirs: [join(tmpdir(), 'mu-watch-does-not-exist-xyz')], onChange: () => {} });
  expect(() => watcher.stop()).not.toThrow();
});
