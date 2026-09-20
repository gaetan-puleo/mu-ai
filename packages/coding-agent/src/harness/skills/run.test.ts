import { expect, test } from 'vitest';
import type { Message } from 'mu-core';
import { createAgentRegistry } from '../agents';
import type { AgentSession } from '../session';
import { createSkillRegistry } from './registry';
import { createRunSkillTool, runSkill } from './run';

test('runSkill composes the agent + skill prompt as system and returns the response', async () => {
  let capturedSystem = '';
  const skills = createSkillRegistry([{ name: 'commit', description: 'd', prompt: 'SKILL-BODY' }]);
  const agents = createAgentRegistry([{ name: 'rev', description: '', prompt: 'AGENT-BODY', tools: ['read'] }]);

  const spawn = (agent: { prompt: string }): AgentSession => {
    capturedSystem = agent.prompt;
    const messages: Message[] = [];
    return {
      id: 'x',
      tools: [],
      get messages() {
        return messages;
      },
      send: async (input) => {
        messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: `done:${typeof input === 'string' ? input : ''}` }],
        });
      },
      abort: () => {},
      subscribe: () => () => {},
    };
  };

  const out = await runSkill({ skills, agents, spawn: spawn as never }, {
    skill: 'commit',
    task: 'ship it',
    agent: 'rev',
  });

  expect(out).toEqual('done:ship it');
  expect(capturedSystem).toEqual('AGENT-BODY\n\nSKILL-BODY');
});

test('runSkill requires a known agent', async () => {
  const skills = createSkillRegistry([{ name: 'commit', description: 'd', prompt: 'BODY' }]);
  const agents = createAgentRegistry([]);
  const spawn = (() => {
    throw new Error('should not spawn');
  }) as never;
  await expect(
    runSkill({ skills, agents, spawn }, { skill: 'commit', task: 't', agent: 'ghost' }),
  ).rejects.toThrow('unknown agent "ghost"');
});

test('run_skill tool: missing agent => error', async () => {
  const skills = createSkillRegistry([{ name: 'commit', description: 'd', prompt: 'BODY' }]);
  const agents = createAgentRegistry([]);
  const tool = createRunSkillTool({
    skills,
    agents,
    spawn: (() => {
      throw new Error('should not spawn');
    }) as never,
  });
  expect(await tool.run({ skill: 'commit', task: 't' }, {})).toEqual([{
    type: 'text',
    text: 'Error: run_skill requires `skill`, `task`, and `agent`.',
  }]);
});

test('skills select filters the view', () => {
  const reg = createSkillRegistry([
    { name: 'a', description: '', prompt: 'A' },
    { name: 'b', description: '', prompt: 'B' },
  ]);
  const only = reg.select(['a']);
  expect(only.list().map((s) => s.name)).toEqual(['a']);
  expect(only.get('b')).toEqual(undefined);
  expect(reg.get('b')?.prompt).toEqual('B');
});
