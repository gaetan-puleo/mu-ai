import { assertEquals } from '@std/assert';
import { createTaskStore } from './store';
import { createMemoryTaskStore } from './memory-store';
import { createScheduler } from './scheduler';
import type { SchedulerEvent } from './types';

const tmp = async (): Promise<string> => await Deno.makeTempDir();

Deno.test('store: create/list/get/update/remove', async () => {
  const dir = await tmp();
  const store = createTaskStore({ dir });
  const task = await store.create({ skill: 'commit', prompt: 'do it', schedule: { kind: 'once' } });
  assertEquals(task.enabled, true);
  assertEquals((await store.list()).length, 1);
  assertEquals((await store.get(task.id))?.skill, 'commit');

  await store.update(task.id, { enabled: false });
  assertEquals((await store.get(task.id))?.enabled, false);

  await store.remove(task.id);
  assertEquals(await store.get(task.id), undefined);
  await Deno.remove(dir, { recursive: true });
});

Deno.test('scheduler: a once task fires at start, records the result, and disables itself', async () => {
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

  assertEquals(ranWith, 'p');
  const after = await store.get(task.id);
  assertEquals(after?.lastResult, { ok: true, output: 'done' });
  assertEquals(after?.enabled, false);
  await Deno.remove(dir, { recursive: true });
});

Deno.test('scheduler: emits started + completed events around a successful run', async () => {
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
  assertEquals(events.map((e) => e.type), ['task_started', 'task_completed']);
});

Deno.test('scheduler: emits task_failed when the runner reports failure', async () => {
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
  assertEquals(failed?.type === 'task_failed' && failed.error, 'boom');
});

Deno.test('memory store: create/get/update/remove without disk', async () => {
  const store = createMemoryTaskStore();
  const task = await store.create({ prompt: 'p', agent: 'arya', schedule: { kind: 'cron', expr: '* * * * *' } });
  assertEquals((await store.list()).length, 1);
  assertEquals((await store.get(task.id))?.agent, 'arya');
  await store.update(task.id, { enabled: false });
  assertEquals((await store.get(task.id))?.enabled, false);
  await store.remove(task.id);
  assertEquals(await store.get(task.id), undefined);
});

Deno.test('scheduler: runNow ignores a disabled task', async () => {
  const dir = await tmp();
  const store = createTaskStore({ dir });
  const task = await store.create({ skill: 's', prompt: 'p', schedule: { kind: 'once' }, enabled: false });

  let ran = false;
  const scheduler = createScheduler({ store, run: async () => (ran = true, { ok: true }) });
  await scheduler.runNow(task.id);
  assertEquals(ran, false);
  await Deno.remove(dir, { recursive: true });
});
