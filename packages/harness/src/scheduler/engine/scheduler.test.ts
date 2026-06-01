import { assertEquals } from '@std/assert';
import { createTaskStore } from './store';
import { createScheduler } from './scheduler';

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
