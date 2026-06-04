import { assertEquals, assertThrows } from '@std/assert';
import type { Agent } from './types';
import { parseAgent } from './parser';
import { createAgentRegistry, toolDecision, toolNames } from './registry';

const agentWith = (tools: Agent['tools']): Agent => ({ name: 'a', description: '', prompt: '', tools });

Deno.test('parseAgent reads the frontmatter and keeps the body as prompt', () => {
  const agent = parseAgent(
    `---\nname: reviewer\ndescription: reviews code\ntools: [read, grep]\nmodel: local/small\n---\nYou are a reviewer.`,
    'fallback',
  );
  assertEquals(agent, {
    name: 'reviewer',
    description: 'reviews code',
    prompt: 'You are a reviewer.',
    tools: ['read', 'grep'],
    model: 'local/small',
    color: undefined,
    extends: undefined,
  });
});

Deno.test('parseAgent reads the color from the frontmatter', () => {
  assertEquals(parseAgent(`---\nname: a\ncolor: '#10B981'\n---\nP`, 'a').color, '#10B981');
});

Deno.test('parseAgent: list the tools without "allow" (array or commas)', () => {
  assertEquals(parseAgent(`---\nname: a\ntools: [ read , grep ]\n---\nP`, 'a').tools, ['read', 'grep']);
  assertEquals(parseAgent(`---\nname: b\ntools: read, grep\n---\nP`, 'b').tools, ['read', 'grep']);
});

Deno.test('parseAgent: tolerates CRLF line endings (Windows)', () => {
  const agent = parseAgent('---\r\nname: reviewer\r\ntools: read, grep\r\n---\r\n\r\nYou review.', 'fallback');
  assertEquals(agent.name, 'reviewer');
  assertEquals(agent.tools, ['read', 'grep']);
  assertEquals(agent.prompt, 'You review.');
});

Deno.test('parseAgent without frontmatter: the whole body = prompt, name = fallback', () => {
  const agent = parseAgent('just a prompt', 'helper');
  assertEquals(agent.name, 'helper');
  assertEquals(agent.prompt, 'just a prompt');
  assertEquals(agent.tools, undefined);
});

Deno.test('parseAgent: invalid YAML frontmatter => body kept, fields ignored', () => {
  const agent = parseAgent(`---\nname: x\ntools: [unclosed\n---\nBody here`, 'fallback');
  assertEquals(agent.name, 'fallback');
  assertEquals(agent.prompt, 'Body here');
  assertEquals(agent.tools, undefined);
});

Deno.test('parseAgent: non-object YAML root => fields ignored', () => {
  const agent = parseAgent(`---\njust a string\n---\nBody`, 'fallback');
  assertEquals(agent.name, 'fallback');
  assertEquals(agent.prompt, 'Body');
});

Deno.test('toolNames: no grants => undefined (deny-by-default at the allow-list)', () => {
  assertEquals(toolNames(agentWith(undefined)), undefined);
});

Deno.test('toolNames: array and object allow-lists => the listed names', () => {
  assertEquals(toolNames(agentWith(['read', 'bash'])), ['read', 'bash']);
  assertEquals(toolNames(agentWith({ read: 'allow', bash: 'ask' })), ['read', 'bash']);
});

Deno.test('toolNames: a non-deny wildcard => ["*"], not undefined (regression: was stripping all tools)', () => {
  assertEquals(toolNames(agentWith({ '*': 'ask', read: 'allow' })), ['*']);
  assertEquals(toolNames(agentWith({ '*': 'allow' })), ['*']);
});

Deno.test('toolNames: explicit denies are dropped from the list', () => {
  assertEquals(toolNames(agentWith({ read: 'allow', bash: 'deny' })), ['read']);
  assertEquals(toolNames(agentWith({ '*': 'deny', read: 'allow' })), ['read']);
});

Deno.test('toolDecision: array => allow listed, deny the rest', () => {
  assertEquals(toolDecision(agentWith(['read']), 'read'), 'allow');
  assertEquals(toolDecision(agentWith(['read']), 'bash'), 'deny');
});

Deno.test('toolDecision: wildcard is the fallback; explicit entries win', () => {
  const agent = agentWith({ '*': 'ask', read: 'allow', bash: 'deny' });
  assertEquals(toolDecision(agent, 'read'), 'allow');
  assertEquals(toolDecision(agent, 'bash'), 'deny');
  assertEquals(toolDecision(agent, 'edit'), 'ask');
});

Deno.test('toolDecision: no grants => allow', () => {
  assertEquals(toolDecision(agentWith(undefined), 'anything'), 'allow');
});

Deno.test('registry: first wins (host > plugins > disk)', () => {
  const reg = createAgentRegistry([
    { name: 'a', description: 'host', prompt: 'H' },
    { name: 'a', description: 'disk', prompt: 'D' },
  ]);
  assertEquals(reg.get('a')?.description, 'host');
});

Deno.test('registry: extends merges the base and overrides', () => {
  const reg = createAgentRegistry([
    { name: 'base', description: 'b', prompt: 'BASE', tools: ['read'] },
    { name: 'child', description: '', prompt: '', extends: 'base', tools: ['read', 'grep'] },
  ]);
  const child = reg.get('child');
  assertEquals(child?.prompt, 'BASE');
  assertEquals(child?.tools, ['read', 'grep']);
});

Deno.test('registry: unknown extends / cycle => error', () => {
  assertThrows(
    () => createAgentRegistry([{ name: 'x', description: '', prompt: '', extends: 'nope' }]),
    Error,
    'extends unknown agent',
  );
  assertThrows(
    () =>
      createAgentRegistry([
        { name: 'a', description: '', prompt: '', extends: 'b' },
        { name: 'b', description: '', prompt: '', extends: 'a' },
      ]),
    Error,
    'cycle',
  );
});
