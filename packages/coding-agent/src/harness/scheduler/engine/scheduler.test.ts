import { expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskStore } from './store';
import { createMemoryTaskStore } from './memory-store';
import { createScheduler } from './scheduler';
import type { SchedulerEvent } from './types';

const tmp = async (): Promise<string> => await fs.mkdtemp(join(tmpdir(), 'mu-test-'));

test('store: create/list/get/update/remove', async () => {
  const dir = await tmp();
  const store = createTaskStore({ dir });
  const task = await store.create({ skill: 'commit', prompt: 'do it', schedule: { kind: 'once' } });
  expect(task.enabled).toEqual(true);
  expect((await store.list()).length).toEqual(1);
  expect((await store.get(task.id))?.skill).toEqual('commit');

  await store.update(task.id, { enabled: false });
  expect((await store.get(task.id))?.enabled).toEqual(false);

  await store.remove(task.id);
  expect(await store.get(task.id)).toEqual(undefined);
  await fs.rm(dir, { recursive: true, force: true });
});

test('scheduler: a once task fires at start, records the result, and disables itself', async () => {
  const dir = await tmp();
  const store = createTaskStore({ dir });
  const task = await store.create({ skill: 's', prompt: 'p', schedule: { kind: 'once' } });

  let ranWith = '';
  const scheduler = createScheduler({
    store,
    run: async (t) => {
      ranWith = t.prompt;
      return { ok: true, output: 'done' };
    },
  });

  await scheduler.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  scheduler.stop();

  expect(ranWith).toEqual('p');
  const after = await store.get(task.id);
  expect(after?.lastResult).toEqual({ ok: true, output: 'done' });
  expect(after?.enabled).toEqual(false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('scheduler: emits started + completed events around a successful run', async () => {
  const store = createMemoryTaskStore([
    { id: 't1', prompt: 'p', schedule: { kind: 'once' }, enabled: true, createdAt: 0 },
  ]);
  const events: SchedulerEvent[] = [];
  const scheduler = createScheduler({
    store,
    run: async () => ({ ok: true, output: 'ok' }),
    onEvent: (e) => events.push(e),
  });
  await scheduler.runNow('t1');
  expect(events.map((e) => e.type)).toEqual(['task_started', 'task_completed']);
});

test('scheduler: emits task_failed when the runner reports failure', async () => {
  const store = createMemoryTaskStore([
    { id: 't1', prompt: 'p', schedule: { kind: 'once' }, enabled: true, createdAt: 0 },
  ]);
  const events: SchedulerEvent[] = [];
  const scheduler = createScheduler({
    store,
    run: async () => ({ ok: false, error: 'boom' }),
    onEvent: (e) => events.push(e),
  });
  await scheduler.runNow('t1');
  const failed = events.find((e) => e.type === 'task_failed');
  expect(failed?.type === 'task_failed' && failed.error).toEqual('boom');
});

test('memory store: create/get/update/remove without disk', async () => {
  const store = createMemoryTaskStore();
  const task = await store.create({ prompt: 'p', agent: 'arya', schedule: { kind: 'cron', expr: '* * * * *' } });
  expect((await store.list()).length).toEqual(1);
  expect((await store.get(task.id))?.agent).toEqual('arya');
  await store.update(task.id, { enabled: false });
  expect((await store.get(task.id))?.enabled).toEqual(false);
  await store.remove(task.id);
  expect(await store.get(task.id)).toEqual(undefined);
});

test('scheduler: runNow ignores a disabled task', async () => {
  const dir = await tmp();
  const store = createTaskStore({ dir });
  const task = await store.create({ skill: 's', prompt: 'p', schedule: { kind: 'once' }, enabled: false });

  let ran = false;
  const scheduler = createScheduler({ store, run: async () => (ran = true, { ok: true }) });
  await scheduler.runNow(task.id);
  expect(ran).toEqual(false);
  await fs.rm(dir, { recursive: true, force: true });
});
