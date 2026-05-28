import { expect } from '@std/expect';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'mu-core';
import { bootstrap } from './bootstrap';
import type { XdgPaths } from './paths/xdg';

function makePaths(root: string): XdgPaths {
  const configDir = join(root, 'config');
  const dataDir = join(root, 'data');
  const stateDir = join(root, 'state');
  for (const d of [configDir, dataDir, stateDir]) mkdirSync(d, { recursive: true });
  return {
    configFile: join(configDir, 'config.json'),
    envFile: join(configDir, '.env'),
    permissionsFile: join(configDir, 'permissions.json'),
    agentsDir: join(configDir, 'agents'),
    skillsDir: join(configDir, 'skills'),
    tasksDir: join(configDir, 'tasks'),
    pluginsDir: join(dataDir, 'plugins'),
    sessionsDir: join(dataDir, 'sessions'),
    stateFile: join(stateDir, 'state.json'),
    historyFile: join(stateDir, 'history.json'),
    pluginsTrustFile: join(configDir, 'plugins-trust.json'),
  };
}

function writeAgent(dir: string, name: string, body: string, frontmatter: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  writeFileSync(join(dir, `${name}.md`), `---\n${fm}\n---\n${body}\n`, 'utf-8');
}

describe('bootstrap', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mu-bootstrap-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the empty defaults when no agents/skills/permissions exist', async () => {
    const paths = makePaths(root);
    const result = await bootstrap({
      hostName: 'mu-test',
      paths,
      sessionStore: 'memory',
    });

    expect(result.primaryAgent).toBeUndefined();
    expect(result.primaryAgents).toEqual([]);
    expect(result.subAgents).toEqual([]);
    expect(result.plugins).toEqual([]);
    expect(result.tools).toEqual({});
    expect(result.systemPrompt()).toBeUndefined();
    expect(result.toolFilter).toBeUndefined();
  });

  it('loads a single primary agent and uses its prompt as the system prompt', async () => {
    const paths = makePaths(root);
    writeAgent(paths.agentsDir, 'rooty', 'You are root.', { name: 'rooty', description: 'root agent', type: 'primary', tools: '*' });

    const result = await bootstrap({
      hostName: 'mu-test',
      paths,
      sessionStore: 'memory',
    });

    expect(result.primaryAgent?.name).toBe('rooty');
    expect(result.primaryAgents).toHaveLength(1);
    expect(result.subAgents).toEqual([]);
    expect(result.systemPrompt()).toContain('You are root.');
  });

  it('splits agents by type — primary[] vs subAgents[]', async () => {
    const paths = makePaths(root);
    writeAgent(paths.agentsDir, 'main', 'I am primary.', { name: 'main', description: 'primary', type: 'primary', tools: '*' });
    writeAgent(paths.agentsDir, 'helper', 'I am a helper.', { name: 'helper', description: 'sub', type: 'subagent', tools: '*' });

    const result = await bootstrap({
      hostName: 'mu-test',
      paths,
      sessionStore: 'memory',
    });

    expect(result.primaryAgents.map((a) => a.name)).toEqual(['main']);
    expect(result.subAgents.map((a) => a.name)).toEqual(['helper']);
  });

  it('falls back to the lone agent as primary when no `type` is declared', async () => {
    const paths = makePaths(root);
    writeAgent(paths.agentsDir, 'solo', 'Just me.', { name: 'solo', description: 'lonely', tools: '*' });

    const result = await bootstrap({
      hostName: 'mu-test',
      paths,
      sessionStore: 'memory',
    });

    expect(result.primaryAgent?.name).toBe('solo');
  });

  it('returns a dynamic toolFilter when getActivePrimary is supplied', async () => {
    const paths = makePaths(root);
    writeAgent(paths.agentsDir, 'a', 'A.', { name: 'a', description: 'A', type: 'primary', tools: ['read'] });
    writeAgent(paths.agentsDir, 'b', 'B.', { name: 'b', description: 'B', type: 'primary', tools: ['write'] });

    let activeName = 'a';
    const result = await bootstrap({
      hostName: 'mu-test',
      paths,
      sessionStore: 'memory',
      baseTools: {
        read: { name: 'read', description: 'r', parameters: {}, execute: () => 'r' },
        write: { name: 'write', description: 'w', parameters: {}, execute: () => 'w' },
      },
      getActivePrimary: () => result.primaryAgents.find((p) => p.name === activeName),
    });

    expect(result.toolFilter).toBeDefined();
    const filteredForA = result.toolFilter!({ read: result.tools.read, write: result.tools.write });
    expect(Object.keys(filteredForA)).toEqual(['read']);

    activeName = 'b';
    const filteredForB = result.toolFilter!({ read: result.tools.read, write: result.tools.write });
    expect(Object.keys(filteredForB)).toEqual(['write']);
  });

  it('static mode (no getActivePrimary) leaves toolFilter undefined', async () => {
    const paths = makePaths(root);
    writeAgent(paths.agentsDir, 'p', 'P.', { name: 'p', description: 'P', type: 'primary', tools: ['read'] });

    const result = await bootstrap({
      hostName: 'mu-test',
      paths,
      sessionStore: 'memory',
      baseTools: {
        read: { name: 'read', description: 'r', parameters: {}, execute: () => 'r' },
        write: { name: 'write', description: 'w', parameters: {}, execute: () => 'w' },
      },
    });

    expect(result.toolFilter).toBeUndefined();
    // Static mode pre-filters the tool map by the primary's allow-list.
    expect(Object.keys(result.tools).sort()).toEqual(['read']);
  });

  it('composes extra plugins into the returned plugin list', async () => {
    const paths = makePaths(root);
    const extra: Plugin = {
      name: 'extra',
      tools: { ping: { name: 'ping', description: 'p', parameters: {}, execute: () => 'pong' } },
    };

    const result = await bootstrap({
      hostName: 'mu-test',
      paths,
      sessionStore: 'memory',
      extraPlugins: [extra],
    });

    expect(result.plugins).toContain(extra);
    // Extra plugins' tools live on `plugins[*].tools`; the runtime merges them
    // at construction. They are not pre-merged into `result.tools`.
    expect(extra.tools?.ping).toBeDefined();
  });

  it('injects a subagent dispatcher tool when sub-agents are present', async () => {
    const paths = makePaths(root);
    writeAgent(paths.agentsDir, 'main', 'M.', { name: 'main', description: 'M', type: 'primary', tools: '*' });
    writeAgent(paths.agentsDir, 'helper', 'H.', { name: 'helper', description: 'H', type: 'subagent', tools: '*' });

    const result = await bootstrap({
      hostName: 'mu-test',
      paths,
      sessionStore: 'memory',
    });

    expect(result.tools.subagent).toBeDefined();
  });

  it('uses an in-memory session store when sessionStore=memory', async () => {
    const paths = makePaths(root);
    const result = await bootstrap({
      hostName: 'mu-test',
      paths,
      sessionStore: 'memory',
    });

    const session = result.store.create({ title: 'test' });
    expect(result.store.get(session.id)).toBe(session);
  });
});
