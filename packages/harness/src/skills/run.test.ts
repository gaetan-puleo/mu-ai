import { assertEquals, assertRejects } from '@std/assert';
import type { Message } from 'mu-core';
import { createAgentRegistry } from '../agents';
import type { AgentSession } from '../session';
import { createSkillRegistry } from './registry';
import { createRunSkillTool, runSkill } from './run';

Deno.test('runSkill composes the agent + skill prompt as system and returns the response', async () => {
  let capturedSystem = '';
  const skills = createSkillRegistry([{ name: 'commit', description: 'd', prompt: 'SKILL-BODY' }]);
  const agents = createAgentRegistry([{ name: 'rev', description: '', prompt: 'AGENT-BODY', tools: ['read'] }]);

  const spawn = (agent: { prompt: string }): AgentSession => {
    capturedSystem = agent.prompt;
    const messages: Message[] = [];
    return {
      id: 'x',
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

  assertEquals(out, 'done:ship it');
  assertEquals(capturedSystem, 'AGENT-BODY\n\nSKILL-BODY');
});

Deno.test('runSkill requires a known agent', async () => {
  const skills = createSkillRegistry([{ name: 'commit', description: 'd', prompt: 'BODY' }]);
  const agents = createAgentRegistry([]);
  const spawn = (() => {
    throw new Error('should not spawn');
  }) as never;
  await assertRejects(
    () => runSkill({ skills, agents, spawn }, { skill: 'commit', task: 't', agent: 'ghost' }),
    Error,
    'unknown agent "ghost"',
  );
});

Deno.test('run_skill tool: missing agent => error', async () => {
  const skills = createSkillRegistry([{ name: 'commit', description: 'd', prompt: 'BODY' }]);
  const agents = createAgentRegistry([]);
  const tool = createRunSkillTool({
    skills,
    agents,
    spawn: (() => {
      throw new Error('should not spawn');
    }) as never,
  });
  assertEquals(await tool.run({ skill: 'commit', task: 't' }, {}), [{
    type: 'text',
    text: 'Error: run_skill requires `skill`, `task`, and `agent`.',
  }]);
});

Deno.test('skills select filters the view', () => {
  const reg = createSkillRegistry([
    { name: 'a', description: '', prompt: 'A' },
    { name: 'b', description: '', prompt: 'B' },
  ]);
  const only = reg.select(['a']);
  assertEquals(only.list().map((s) => s.name), ['a']);
  assertEquals(only.get('b'), undefined);
  assertEquals(reg.get('b')?.prompt, 'B');
});
