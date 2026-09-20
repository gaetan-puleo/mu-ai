import { expect, test } from 'vitest';
import type { Agent } from './types';
import { parseAgent } from './parser';
import { createAgentRegistry, toolDecision, toolNames } from './registry';

const agentWith = (tools: Agent['tools']): Agent => ({ name: 'a', description: '', prompt: '', tools });

test('parseAgent reads the frontmatter and keeps the body as prompt', () => {
  const agent = parseAgent(
    `---\nname: reviewer\ndescription: reviews code\ntools: [read, grep]\nmodel: local/small\n---\nYou are a reviewer.`,
    'fallback',
  );
  expect(agent).toEqual({
    name: 'reviewer',
    description: 'reviews code',
    prompt: 'You are a reviewer.',
    tools: ['read', 'grep'],
    model: 'local/small',
    color: undefined,
    extends: undefined,
  });
});

test('parseAgent reads the color from the frontmatter', () => {
  expect(parseAgent(`---\nname: a\ncolor: '#10B981'\n---\nP`, 'a').color).toEqual('#10B981');
});

test('parseAgent: list the tools without "allow" (array or commas)', () => {
  expect(parseAgent(`---\nname: a\ntools: [ read , grep ]\n---\nP`, 'a').tools).toEqual(['read', 'grep']);
  expect(parseAgent(`---\nname: b\ntools: read, grep\n---\nP`, 'b').tools).toEqual(['read', 'grep']);
});

test('parseAgent: nested argument-level grants (tools.skill / tools.bash) parse into sub-maps', () => {
  const agent = parseAgent(
    `---\nname: a\ntools:\n  "*": allow\n  skill:\n    research: allow\n    secret: deny\n  bash:\n    "git *": allow\n    "rm *": deny\n---\nP`,
    'a',
  );
  expect(agent.tools).toEqual({
    '*': 'allow',
    skill: { research: 'allow', secret: 'deny' },
    bash: { 'git *': 'allow', 'rm *': 'deny' },
  });
});

test('parseAgent: invalid nested decisions are dropped, empty maps omitted', () => {
  expect(parseAgent(`---\nname: a\ntools:\n  skill:\n    x: bogus\n---\nP`, 'a').tools).toEqual(undefined);
});

test('parseAgent: tolerates CRLF line endings (Windows)', () => {
  const agent = parseAgent('---\r\nname: reviewer\r\ntools: read, grep\r\n---\r\n\r\nYou review.', 'fallback');
  expect(agent.name).toEqual('reviewer');
  expect(agent.tools).toEqual(['read', 'grep']);
  expect(agent.prompt).toEqual('You review.');
});

test('parseAgent without frontmatter: the whole body = prompt, name = fallback', () => {
  const agent = parseAgent('just a prompt', 'helper');
  expect(agent.name).toEqual('helper');
  expect(agent.prompt).toEqual('just a prompt');
  expect(agent.tools).toEqual(undefined);
});

test('parseAgent: invalid YAML frontmatter => body kept, fields ignored', () => {
  const agent = parseAgent(`---\nname: x\ntools: [unclosed\n---\nBody here`, 'fallback');
  expect(agent.name).toEqual('fallback');
  expect(agent.prompt).toEqual('Body here');
  expect(agent.tools).toEqual(undefined);
});

test('parseAgent: non-object YAML root => fields ignored', () => {
  const agent = parseAgent(`---\njust a string\n---\nBody`, 'fallback');
  expect(agent.name).toEqual('fallback');
  expect(agent.prompt).toEqual('Body');
});

test('toolNames: no grants => undefined (deny-by-default at the allow-list)', () => {
  expect(toolNames(agentWith(undefined))).toEqual(undefined);
});

test('toolNames: array and object allow-lists => the listed names', () => {
  expect(toolNames(agentWith(['read', 'bash']))).toEqual(['read', 'bash']);
  expect(toolNames(agentWith({ read: 'allow', bash: 'ask' }))).toEqual(['read', 'bash']);
});

test('toolNames: a non-deny wildcard => ["*"], not undefined (regression: was stripping all tools)', () => {
  expect(toolNames(agentWith({ '*': 'ask', read: 'allow' }))).toEqual(['*']);
  expect(toolNames(agentWith({ '*': 'allow' }))).toEqual(['*']);
});

test('toolNames: explicit denies are dropped from the list', () => {
  expect(toolNames(agentWith({ read: 'allow', bash: 'deny' }))).toEqual(['read']);
  expect(toolNames(agentWith({ '*': 'deny', read: 'allow' }))).toEqual(['read']);
});

test('toolDecision: array => allow listed, deny the rest', () => {
  expect(toolDecision(agentWith(['read']), 'read')).toEqual('allow');
  expect(toolDecision(agentWith(['read']), 'bash')).toEqual('deny');
});

test('toolDecision: wildcard is the fallback; explicit entries win', () => {
  const agent = agentWith({ '*': 'ask', read: 'allow', bash: 'deny' });
  expect(toolDecision(agent, 'read')).toEqual('allow');
  expect(toolDecision(agent, 'bash')).toEqual('deny');
  expect(toolDecision(agent, 'edit')).toEqual('ask');
});

test('toolDecision: no grants => allow', () => {
  expect(toolDecision(agentWith(undefined), 'anything')).toEqual('allow');
});

test('grant decision matches glob patterns: exact > glob > wildcard', () => {
  const agent = agentWith({ '*': 'allow', 'internal-*': 'deny', 'experimental-*': 'ask', 'internal-public': 'allow' });
  expect(toolDecision(agent, 'read')).toEqual('allow');
  expect(toolDecision(agent, 'internal-fs')).toEqual('deny');
  expect(toolDecision(agent, 'internal-public')).toEqual('allow');
  expect(toolDecision(agent, 'experimental-x')).toEqual('ask');
});

test('nested argument-level grants resolve via the second arg', () => {
  const agent = agentWith({
    '*': 'allow',
    skill: { '*': 'allow', 'internal-*': 'deny', 'experimental-*': 'ask' },
    bash: { 'git *': 'allow', 'rm *': 'deny' },
  });
  expect(toolDecision(agent, 'read')).toEqual('allow');
  expect(toolDecision(agent, 'skill', 'pr-review')).toEqual('allow');
  expect(toolDecision(agent, 'skill', 'internal-deploy')).toEqual('deny');
  expect(toolDecision(agent, 'skill', 'experimental-x')).toEqual('ask');
  expect(toolDecision(agent, 'bash', 'git push')).toEqual('allow');
  expect(toolDecision(agent, 'bash', 'rm -rf /')).toEqual('deny');
  expect(toolDecision(agent, 'bash', 'ls')).toEqual('deny');
});

test('a nested grant means the tool is present at tool-level (no arg)', () => {
  const agent = agentWith({ bash: { 'git *': 'allow' } });
  expect(toolDecision(agent, 'bash')).toEqual('allow');
  expect(toolNames(agent)).toEqual(['bash']);
});

test('registry: first wins (host > plugins > disk)', () => {
  const reg = createAgentRegistry([
    { name: 'a', description: 'host', prompt: 'H' },
    { name: 'a', description: 'disk', prompt: 'D' },
  ]);
  expect(reg.get('a')?.description).toEqual('host');
});

test('registry: extends merges the base and overrides', () => {
  const reg = createAgentRegistry([
    { name: 'base', description: 'b', prompt: 'BASE', tools: ['read'] },
    { name: 'child', description: '', prompt: '', extends: 'base', tools: ['read', 'grep'] },
  ]);
  const child = reg.get('child');
  expect(child?.prompt).toEqual('BASE');
  expect(child?.tools).toEqual(['read', 'grep']);
});

test('registry: unknown extends / cycle => error', () => {
  expect(() => createAgentRegistry([{ name: 'x', description: '', prompt: '', extends: 'nope' }])).toThrow('extends unknown agent');
  expect(() =>
      createAgentRegistry([
        { name: 'a', description: '', prompt: '', extends: 'b' },
        { name: 'b', description: '', prompt: '', extends: 'a' },
      ])).toThrow('cycle');
});

test('registry: add registers a new agent live and get()/list() see it', () => {
  const reg = createAgentRegistry([{ name: 'a', description: 'A', prompt: 'PA' }]);
  expect(reg.get('b')).toEqual(undefined);
  reg.add({ name: 'b', description: 'B', prompt: 'PB', tools: ['read'] });
  expect(reg.get('b')?.prompt).toEqual('PB');
  expect(reg.list().map((x) => x.name).sort()).toEqual(['a', 'b']);
});

test('registry: add replaces an existing agent and re-resolves its dependents', () => {
  const reg = createAgentRegistry([
    { name: 'base', description: '', prompt: 'OLD', tools: ['read'] },
    { name: 'child', description: '', prompt: '', extends: 'base' },
  ]);
  expect(reg.get('child')?.prompt).toEqual('OLD');
  reg.add({ name: 'base', description: '', prompt: 'NEW', tools: ['read', 'grep'] });
  expect(reg.get('base')?.prompt).toEqual('NEW');
  expect(reg.get('child')?.prompt).toEqual('NEW');
  expect(reg.get('child')?.tools).toEqual(['read', 'grep']);
});

test('registry: replaceAll rebuilds in place — add, edit and delete', () => {
  const reg = createAgentRegistry([
    { name: 'a', description: 'A1', prompt: 'PA' },
    { name: 'b', description: 'B', prompt: 'PB' },
  ]);
  expect(reg.list().map((x) => x.name).sort()).toEqual(['a', 'b']);
  reg.replaceAll([
    { name: 'a', description: 'A2', prompt: 'PA2' }, // edited
    { name: 'c', description: 'C', prompt: 'PC' }, // added; b removed
  ]);
  expect(reg.list().map((x) => x.name).sort()).toEqual(['a', 'c']);
  expect(reg.get('a')?.description).toEqual('A2');
  expect(reg.get('b')).toEqual(undefined);
});
