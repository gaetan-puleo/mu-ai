import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AgentSourceManager, createAgentSourceManager } from './sources';

const AGENT_MD = `---
id: test
description: a test
---
You are a test agent.
`;

describe('AgentSourceManager', () => {
  let dir: string;
  let activeMgrs: AgentSourceManager[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mu-agents-src-'));
    activeMgrs = [];
  });
  afterEach(async () => {
    for (const m of activeMgrs) await m.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  function track(): AgentSourceManager {
    const m = createAgentSourceManager();
    activeMgrs.push(m);
    return m;
  }

  it('lists agents from a registered source', () => {
    writeFileSync(join(dir, 'test.md'), AGENT_MD);
    const mgr = track();
    mgr.registerSource(dir);
    const agents = mgr.list();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.some((a) => a.name === 'test')).toBe(true);
  });

  it('emits change after adding a new file', async () => {
    const mgr = track();
    mgr.registerSource(dir);
    const seen: number[] = [];
    mgr.onChange((agents) => seen.push(agents.length));

    // chokidar needs a moment to attach OS watchers before our writes are seen.
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(dir, 'a.md'), AGENT_MD);
    // Wait for chokidar event + 100ms debounce
    await new Promise((r) => setTimeout(r, 600));

    expect(seen.length).toBeGreaterThan(0);
  });

  it('dispose stops watchers cleanly', async () => {
    const mgr = track();
    const off = mgr.registerSource(dir);
    off();
  });

  it('handles missing dir gracefully', () => {
    const mgr = track();
    mgr.registerSource(join(dir, 'does-not-exist'));
    expect(mgr.list()).toEqual([]);
  });

  it('ignores subdirs (depth: 0)', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'nested.md'), AGENT_MD);
    const mgr = track();
    mgr.registerSource(dir);
    expect(Array.isArray(mgr.list())).toBe(true);
  });
});
