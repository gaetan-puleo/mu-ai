import { expect, test } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentPart, Provider } from 'mu-core';
import type { Agent } from '../agents';
import type { Skill } from '../skills';
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
  const dir = await mkdtemp(join(tmpdir(), 'mu-test-'));
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
    await rm(dir, { recursive: true, force: true });
  };
  return { dir, harness, cleanup };
};

test('createHarness exposes config + sub-objects', async () => {
  const { dir, harness, cleanup } = await makeHarness();
  expect(harness.config).toEqual({
    hostName: 'mu',
    configDir: `${dir}/mu`,
    dataDir: `${dir}/mu`,
    stateDir: `${dir}/mu`,
  });
  expect(harness.models.selected).toEqual('local/m');
  await cleanup();
});

test('models.select validates format and provider', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([]), anthropic: scripted([]) },
    model: 'local/llama',
  });
  harness.models.select('anthropic/claude');
  expect(harness.models.selected).toEqual('anthropic/claude');
  expect(() => harness.models.select('local')).toThrow('model must be "provider/model"');
  expect(() => harness.models.select('nope/x')).toThrow('unknown provider "nope"');
  await cleanup();
});

test('sessions: create persists, list, open re-reads, delete removes', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'text', text: 'bonjour' }]]) },
  });

  const session = harness.sessions.create();
  await session.send('salut');

  expect((await harness.sessions.list()).map((r) => r.id)).toEqual([session.id]);

  const reopened = await harness.sessions.open(session.id);
  expect(reopened.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'bonjour' }] });

  await harness.sessions.delete(session.id);
  expect(await harness.sessions.list()).toEqual([]);

  await cleanup();
});

test('sessions: list filters by cwd', async () => {
  const { harness, cleanup } = await makeHarness();

  harness.sessions.create({ cwd: '/proj/a' });
  harness.sessions.create({ cwd: '/proj/a' });
  harness.sessions.create({ cwd: '/proj/b' });

  expect((await harness.sessions.list({ cwd: '/proj/a' })).length).toEqual(2);
  expect((await harness.sessions.list({ cwd: '/proj/b' })).length).toEqual(1);
  expect((await harness.sessions.list()).length).toEqual(3);

  await cleanup();
});

test('sessions: fork cuts at a message and inherits the cwd', async () => {
  const { harness, cleanup } = await makeHarness({ providers: { local: scripted([[{ type: 'text', text: 'r1' }]]) } });

  const session = harness.sessions.create({ cwd: '/proj/z' });
  await session.send('msg-0');
  await session.send('msg-1');

  const forked = await harness.sessions.fork(session.id, 0);
  expect(forked.id !== session.id).toEqual(true);
  expect(forked.messages.length).toEqual(1);
  expect(forked.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'msg-0' }] });
  expect((await harness.sessions.get(forked.id))?.cwd).toEqual('/proj/z');

  await cleanup();
});

test('plugins: write/list/remove under pluginsDir', async () => {
  const { dir, harness, cleanup } = await makeHarness();
  const path = await harness.plugins.write('demo.ts', 'export default {};');
  expect(path).toEqual(`${dir}/mu/plugins/demo.ts`);
  expect(await harness.plugins.list()).toEqual(['demo.ts']);
  await harness.plugins.remove('demo.ts');
  expect(await harness.plugins.list()).toEqual([]);
  await cleanup();
});

test('agents: the registry is wired from the host options', async () => {
  const reviewer: Agent = { name: 'reviewer', description: 'reviews', prompt: 'You review.' };
  const { harness, cleanup } = await makeHarness({ agents: [reviewer] });
  expect(harness.agents.get('reviewer')?.prompt).toEqual('You review.');
  expect(harness.agents.list().map((a) => a.name)).toEqual(['reviewer']);
  await cleanup();
});

test('agents: createHarness loads sub-agents from a configured agentDirs.local', async () => {
  const localDir = await mkdtemp(join(tmpdir(), 'mu-test-'));
  await writeFile(`${localDir}/helper.md`, '---\nname: helper\ndescription: helps\n---\nYou help.');
  const { harness, cleanup } = await makeHarness({ agentDirs: { local: localDir } });
  expect(harness.agents.get('helper')?.prompt).toEqual('You help.');
  await cleanup();
  await rm(localDir, { recursive: true, force: true });
});

test('skill commands: opt-in `command` registers a runnable slash command; others get none', async () => {
  const arya: Agent = { name: 'arya', description: '', prompt: 'You are arya.' };
  const withCmd: Skill = { name: 'greet', description: 'Greets', prompt: 'Say hello.', command: 'greet' };
  const noCmd: Skill = { name: 'plain', description: 'Plain', prompt: 'Nothing.' };
  const { harness, cleanup } = await makeHarness({
    agents: [arya],
    skills: [withCmd, noCmd],
    providers: { local: scripted([[{ type: 'text', text: 'Hello!' }]]) },
  });

  // Registered for the opt-in skill only.
  expect(harness.commands.get('greet')?.name).toEqual('greet');
  expect(harness.commands.get('plain')).toEqual(undefined);

  // Invoking it runs the skill and returns its output.
  const result = await harness.commands.run('/greet say hi', {});
  expect(result.ok).toEqual(true);
  expect(String(result.output)).toContain('Hello!');

  // Survives a hot-reload (host skills persist; the command is re-synced).
  await harness.reloadDefinitions();
  expect(harness.commands.get('greet')?.name).toEqual('greet');

  await cleanup();
});

test('reloadDefinitions: create/edit/delete agents on disk; defaultAgents is the fallback', async () => {
  const localDir = await mkdtemp(join(tmpdir(), 'mu-test-'));
  const fallback: Agent = { name: 'arya', description: 'built-in', prompt: 'BUILTIN' };
  const { harness, cleanup } = await makeHarness({ agentDirs: { local: localDir }, defaultAgents: [fallback] });

  // Fallback present when nothing is on disk.
  expect(harness.agents.get('arya')?.prompt).toEqual('BUILTIN');

  // Create on disk + reload → visible.
  await writeFile(`${localDir}/helper.md`, '---\nname: helper\ndescription: h\n---\nYou help.');
  await harness.reloadDefinitions();
  expect(harness.agents.get('helper')?.prompt).toEqual('You help.');

  // A disk agent overrides the default fallback by name.
  await writeFile(`${localDir}/arya.md`, '---\nname: arya\ndescription: custom\n---\nCUSTOM');
  await harness.reloadDefinitions();
  expect(harness.agents.get('arya')?.prompt).toEqual('CUSTOM');

  // Delete both → override gives way to the fallback, helper disappears.
  await rm(`${localDir}/arya.md`, { force: true });
  await rm(`${localDir}/helper.md`, { force: true });
  await harness.reloadDefinitions();
  expect(harness.agents.get('arya')?.prompt).toEqual('BUILTIN');
  expect(harness.agents.get('helper')).toEqual(undefined);

  await cleanup();
  await rm(localDir, { recursive: true, force: true });
});

const waitForTitle = async (harness: Harness, id: string) => {
  for (let i = 0; i < 100; i++) {
    const record = await harness.sessions.get(id);
    if (record?.title && record.title !== 'first message here') return record.title;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return (await harness.sessions.get(id))?.title;
};

test('title: internal sub-agent titles the session on the 1st message (dedicated provider)', async () => {
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
  expect(await waitForTitle(harness, session.id)).toEqual('Titre Genere');

  await cleanup();
});

test('title: disabled (title:false) => no title', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'text', text: 'reponse' }]]) },
  });
  const session = harness.sessions.create();
  await session.send('first message here');
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect((await harness.sessions.get(session.id))?.title).toEqual(undefined);
  await cleanup();
});

test('scheduler: disabled by default (no scheduler/tasks, no tools)', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'tool_call', id: '1', name: 'run_skill', input: {} }]]) },
    skills: [{ name: 'commit', description: 'd', prompt: 'BODY' }],
  });
  expect(harness.scheduler).toEqual(undefined);
  expect(harness.tasks).toEqual(undefined);
  expect(harness.commands.get('tasks')).toEqual(undefined);
  await cleanup();
});

test('scheduler: enabled exposes tasks/scheduler and runs a task via runNow', async () => {
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'text', text: 'ok' }]]) },
    skills: [{ name: 'commit', description: 'd', prompt: 'BODY' }],
    agents: [{ name: 'worker', description: '', prompt: 'WORKER' }],
    scheduler: true,
  });

  expect(harness.commands.get('tasks')?.name).toEqual('tasks');
  const task = await harness.tasks!.create({
    skill: 'commit',
    prompt: 'go',
    agent: 'worker',
    schedule: { kind: 'once' },
  });
  await harness.scheduler!.runNow(task.id);

  expect((await harness.tasks!.get(task.id))?.lastResult).toEqual({ ok: true, output: 'ok' });
  await cleanup();
});

test('subagent: end-to-end delegation via the tool injected into the parent', async () => {
  const reviewer: Agent = { name: 'reviewer', description: 'reviews', prompt: 'You review.' };
  const { dir, harness, cleanup } = await makeHarness({
    providers: {
      local: scripted([
        [{ type: 'tool_call', id: '1', name: 'subagent', input: { tasks: [{ agent: 'reviewer', task: 'audit' }] } }],
        [{ type: 'text', text: 'reviewed' }],
        [{ type: 'text', text: 'done' }],
      ]),
    },
    agents: [reviewer],
  });

  const session = harness.sessions.create();
  await session.send('delegue');

  const toolResult = session.messages.find((m) => m.role === 'tool' && m.content[0]?.type === 'tool_result');
  expect(toolResult?.content[0]).toEqual({ type: 'tool_result', id: '1', content: [{ type: 'text', text: 'reviewed' }] });
  expect(session.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'done' }] });

  const run = harness.subAgents.byParent(session.id)[0];
  expect(run?.agent).toEqual('reviewer');

  const files: string[] = [];
  for (const entry of await readdir(`${dir}/mu/sessions`, { withFileTypes: true })) files.push(entry.name);
  expect(files.sort()).toEqual([`${run.runId}.jsonl`, `${session.id}.jsonl`].sort());

  expect((await harness.sessions.list()).map((r) => r.id)).toEqual([session.id]);
  expect((await harness.sessions.list({ parentId: session.id })).map((r) => r.id)).toEqual([run.runId]);

  const subHistory = await harness.sessions.read(run.runId);
  expect(subHistory?.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'reviewed' }] });

  await cleanup();
});

test('dispatchSubAgent: host-initiated run registers under the parent and returns the answer', async () => {
  const reviewer: Agent = { name: 'reviewer', description: 'reviews', prompt: 'You review.' };
  const { harness, cleanup } = await makeHarness({
    providers: { local: scripted([[{ type: 'text', text: 'reviewed' }]]) },
    agents: [reviewer],
  });

  const result = await harness.dispatchSubAgent('reviewer', 'audit this', 'parent-1');
  expect(result).toEqual({ agent: 'reviewer', text: 'reviewed' });

  const run = harness.subAgents.byParent('parent-1')[0];
  expect(run?.agent).toEqual('reviewer');

  await cleanup();
});

test('dispatchSubAgent: throws on an unknown agent', async () => {
  const { harness, cleanup } = await makeHarness();
  let message = '';
  try {
    await harness.dispatchSubAgent('ghost', 'task', 'parent-1');
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toEqual('unknown sub-agent "ghost"');
  await cleanup();
});
