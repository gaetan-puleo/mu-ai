import { assertEquals, assertThrows } from '@std/assert';
import type { ContentPart, Provider } from 'mu-core';
import type { Agent } from '../agents';
import { createHarness } from './create';
import type { Harness, HarnessOptions } from './types';

const scripted = (turns: ContentPart[][]): Provider => {
  let i = 0;
  return {
    async *stream() {
      for (const event of turns[i++] ?? []) yield event;
    },
  };
};

const makeHarness = async (extra: Partial<HarnessOptions> = {}) => {
  const dir = await Deno.makeTempDir();
  const harness = await createHarness({
    hostName: 'mu',
    xdg: { configHome: dir, dataHome: dir, stateHome: dir },
    providers: { local: scripted([]) },
    model: 'local/m',
    title: false,
    ...extra,
  });
  const cleanup = async () => {
    harness.close();
    await Deno.remove(dir, { recursive: true });
  };
  return { dir, harness, cleanup };
};

Deno.test('createHarness exposes config + sub-objects', async () => {
  const { dir, harness, cleanup } = await makeHarness();
  assertEquals(harness.config, {
    hostName: 'mu',
    configDir: `${dir}/mu`,
    dataDir: `${dir}/mu`,
    stateDir: `${dir}/mu`,
  });
  assertEquals(harness.models.selected, 'local/m');
  await cleanup();
});

Deno.test('models.select validates format and provider', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([]), anthropic: scripted([]) },
    model: 'local/llama',
  });
  harness.models.select('anthropic/claude');
  assertEquals(harness.models.selected, 'anthropic/claude');
  assertThrows(() => harness.models.select('local'), Error, 'model must be "provider/model"');
  assertThrows(() => harness.models.select('nope/x'), Error, 'unknown provider "nope"');
  await cleanup();
});

Deno.test('sessions: create persists, list, open re-reads, delete removes', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'text', text: 'bonjour' }]]) },
  });

  const session = harness.sessions.create();
  await session.send('salut');

  assertEquals((await harness.sessions.list()).map((r) => r.id), [session.id]);

  const reopened = await harness.sessions.open(session.id);
  assertEquals(reopened.messages.at(-1), { role: 'assistant', content: [{ type: 'text', text: 'bonjour' }] });

  await harness.sessions.delete(session.id);
  assertEquals(await harness.sessions.list(), []);

  await cleanup();
});

Deno.test('sessions: list filters by cwd', async () => {
  const { harness, cleanup } = await makeHarness();

  harness.sessions.create({ cwd: '/proj/a' });
  harness.sessions.create({ cwd: '/proj/a' });
  harness.sessions.create({ cwd: '/proj/b' });

  assertEquals((await harness.sessions.list({ cwd: '/proj/a' })).length, 2);
  assertEquals((await harness.sessions.list({ cwd: '/proj/b' })).length, 1);
  assertEquals((await harness.sessions.list()).length, 3);

  await cleanup();
});

Deno.test('sessions: fork cuts at a message and inherits the cwd', async () => {
  const { harness, cleanup } = await makeHarness({ providers: { local: scripted([[{ type: 'text', text: 'r1' }]]) } });

  const session = harness.sessions.create({ cwd: '/proj/z' });
  await session.send('msg-0');
  await session.send('msg-1');

  const forked = await harness.sessions.fork(session.id, 0);
  assertEquals(forked.id !== session.id, true);
  assertEquals(forked.messages.length, 1);
  assertEquals(forked.messages[0], { role: 'user', content: [{ type: 'text', text: 'msg-0' }] });
  assertEquals((await harness.sessions.get(forked.id))?.cwd, '/proj/z');

  await cleanup();
});

Deno.test('plugins: write/list/remove under pluginsDir', async () => {
  const { dir, harness, cleanup } = await makeHarness();
  const path = await harness.plugins.write('demo.ts', 'export default {};');
  assertEquals(path, `${dir}/mu/plugins/demo.ts`);
  assertEquals(await harness.plugins.list(), ['demo.ts']);
  await harness.plugins.remove('demo.ts');
  assertEquals(await harness.plugins.list(), []);
  await cleanup();
});

Deno.test('agents: the registry is wired from the host options', async () => {
  const reviewer: Agent = { name: 'reviewer', description: 'reviews', prompt: 'You review.' };
  const { harness, cleanup } = await makeHarness({ agents: [reviewer] });
  assertEquals(harness.agents.get('reviewer')?.prompt, 'You review.');
  assertEquals(harness.agents.list().map((a) => a.name), ['reviewer']);
  await cleanup();
});

const waitForTitle = async (harness: Harness, id: string) => {
  for (let i = 0; i < 100; i++) {
    const record = await harness.sessions.get(id);
    if (record?.title && record.title !== 'first message here') return record.title;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return (await harness.sessions.get(id))?.title;
};

Deno.test('title: internal sub-agent titles the session on the 1st message (dedicated provider)', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: {
      local: scripted([[{ type: 'text', text: 'reponse' }]]),
      titler: scripted([[{ type: 'text', text: 'Titre Genere' }]]),
    },
    title: true,
    titleModel: 'titler/m',
  });

  const session = harness.sessions.create();
  await session.send('first message here');
  assertEquals(await waitForTitle(harness, session.id), 'Titre Genere');

  await cleanup();
});

Deno.test('title: disabled (title:false) => no title', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'text', text: 'reponse' }]]) },
  });
  const session = harness.sessions.create();
  await session.send('first message here');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assertEquals((await harness.sessions.get(session.id))?.title, undefined);
  await cleanup();
});

Deno.test('scheduler: disabled by default (no scheduler/tasks, no tools)', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'tool_call', id: '1', name: 'run_skill', input: {} }]]) },
    skills: [{ name: 'commit', description: 'd', prompt: 'BODY' }],
  });
  assertEquals(harness.scheduler, undefined);
  assertEquals(harness.tasks, undefined);
  assertEquals(harness.commands.get('tasks'), undefined);
  await cleanup();
});

Deno.test('scheduler: enabled exposes tasks/scheduler and runs a task via runNow', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'text', text: 'ok' }]]) },
    skills: [{ name: 'commit', description: 'd', prompt: 'BODY' }],
    agents: [{ name: 'worker', description: '', prompt: 'WORKER' }],
    scheduler: true,
  });

  assertEquals(harness.commands.get('tasks')?.name, 'tasks');
  const task = await harness.tasks!.create({
    skill: 'commit',
    prompt: 'go',
    agent: 'worker',
    schedule: { kind: 'once' },
  });
  await harness.scheduler!.runNow(task.id);

  assertEquals((await harness.tasks!.get(task.id))?.lastResult, { ok: true, output: 'ok' });
  await cleanup();
});

Deno.test('subagent: end-to-end delegation via the tool injected into the parent', async () => {
  const reviewer: Agent = { name: 'reviewer', description: 'reviews', prompt: 'You review.' };
  const { dir, harness, cleanup } = await makeHarness({
    providers: {
      local: scripted([
        [{ type: 'tool_call', id: '1', name: 'subagent', input: { agent: 'reviewer', task: 'audit' } }],
        [{ type: 'text', text: 'reviewed' }],
        [{ type: 'text', text: 'done' }],
      ]),
    },
    agents: [reviewer],
  });

  const session = harness.sessions.create();
  await session.send('delegue');

  const toolResult = session.messages.find((m) => m.role === 'user' && m.content[0]?.type === 'tool_result');
  assertEquals(toolResult?.content[0], { type: 'tool_result', id: '1', content: [{ type: 'text', text: 'reviewed' }] });
  assertEquals(session.messages.at(-1), { role: 'assistant', content: [{ type: 'text', text: 'done' }] });

  const run = harness.subAgents.byParent(session.id)[0];
  assertEquals(run?.agent, 'reviewer');

  const files: string[] = [];
  for await (const entry of Deno.readDir(`${dir}/mu/sessions`)) files.push(entry.name);
  assertEquals(files.sort(), [`${run.runId}.jsonl`, `${session.id}.jsonl`].sort());

  assertEquals((await harness.sessions.list()).map((r) => r.id), [session.id]);
  assertEquals((await harness.sessions.list({ parentId: session.id })).map((r) => r.id), [run.runId]);

  const subHistory = await harness.sessions.read(run.runId);
  assertEquals(subHistory?.messages.at(-1), { role: 'assistant', content: [{ type: 'text', text: 'reviewed' }] });

  await cleanup();
});

Deno.test('dispatchSubAgent: host-initiated run registers under the parent and returns the answer', async () => {
  const reviewer: Agent = { name: 'reviewer', description: 'reviews', prompt: 'You review.' };
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'text', text: 'reviewed' }]]) },
    agents: [reviewer],
  });

  const result = await harness.dispatchSubAgent('reviewer', 'audit this', 'parent-1');
  assertEquals(result, { agent: 'reviewer', text: 'reviewed' });

  const run = harness.subAgents.byParent('parent-1')[0];
  assertEquals(run?.agent, 'reviewer');

  await cleanup();
});

Deno.test('dispatchSubAgent: throws on an unknown agent', async () => {
  const { harness, cleanup } = await makeHarness();
  let message = '';
  try {
    await harness.dispatchSubAgent('ghost', 'task', 'parent-1');
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message, 'unknown sub-agent "ghost"');
  await cleanup();
});
