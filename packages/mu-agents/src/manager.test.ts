import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentManager } from './manager';
import type { AgentDefinition } from './types';

const PRIMARY: AgentDefinition[] = [
  { name: 'a', description: '', tools: [], systemPrompt: '', type: 'primary' },
  { name: 'b', description: '', tools: [], systemPrompt: '', type: 'primary' },
  { name: 'c', description: '', tools: [], systemPrompt: '', type: 'primary' },
];

let tmp: string;
let settingsPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mu-agents-mgr-'));
  settingsPath = join(tmp, 'state.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('AgentManager — global default', () => {
  it('starts with first primary when no settings file', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    expect(mgr.getActiveFor(null)?.name).toBe('a');
  });

  it('persists global default to disk on switch', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    mgr.setActiveFor('b', null);
    const persisted = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(persisted.currentAgent).toBe('b');
  });

  it('restores global default from settings file', () => {
    const m1 = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    m1.setActiveFor('c', null);
    const m2 = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    expect(m2.getActiveFor(null)?.name).toBe('c');
  });

  it('falls back when persisted agent no longer exists', () => {
    const m1 = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    m1.setActiveFor('c', null);
    const reduced = PRIMARY.filter((a) => a.name !== 'c');
    const m2 = new AgentManager({ primary: reduced, subagent: [], settingsPath });
    expect(m2.getActiveFor(null)?.name).toBe('a');
  });

  it('cycle wraps around', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    mgr.cycle();
    expect(mgr.getActiveFor(null)?.name).toBe('b');
    mgr.cycle();
    expect(mgr.getActiveFor(null)?.name).toBe('c');
    mgr.cycle();
    expect(mgr.getActiveFor(null)?.name).toBe('a');
  });

  it('notifies listeners on change but not on no-op', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    const events: string[] = [];
    mgr.onChange((a) => a && events.push(a.name));
    mgr.setActiveFor('b', null);
    mgr.setActiveFor('b', null); // no-op
    mgr.setActiveFor('a', null);
    expect(events).toEqual(['b', 'a']);
  });

  it('returns false when switching to unknown agent', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    expect(mgr.setActiveFor('missing', null)).toBe(false);
    expect(mgr.getActiveFor(null)?.name).toBe('a');
  });

  it('exposes subagents as read-only list', () => {
    const sub: AgentDefinition[] = [{ name: 'review', description: '', tools: [], systemPrompt: '', type: 'subagent' }];
    const mgr = new AgentManager({ primary: PRIMARY, subagent: sub, settingsPath });
    expect(mgr.getSubagent('review')?.name).toBe('review');
    expect(mgr.getSubagent('missing')).toBeUndefined();
  });
});

describe('AgentManager — per-session', () => {
  it('getActiveFor returns global default when no override', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    expect(mgr.getActiveFor('sess-1')?.name).toBe('a');
  });

  it('setActiveFor sets per-session override', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    mgr.setActiveFor('b', 'sess-1');
    expect(mgr.getActiveFor('sess-1')?.name).toBe('b');
    expect(mgr.getActiveFor(null)?.name).toBe('a');
    expect(mgr.getActiveFor('sess-2')?.name).toBe('a');
  });

  it('clearSessionAgent removes override', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    mgr.setActiveFor('c', 'sess-1');
    mgr.clearSessionAgent('sess-1');
    expect(mgr.getActiveFor('sess-1')?.name).toBe('a');
  });

  it('setAgents prunes stale per-session overrides', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    mgr.setActiveFor('c', 'sess-1');
    mgr.setAgents(PRIMARY.filter((a) => a.name !== 'c'), []);
    expect(mgr.getActiveFor('sess-1')?.name).toBe('a');
  });

  it('onChange fires with sessionId', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    const events: Array<{ name: string; sid: string | null }> = [];
    mgr.onChange((a, sid) => a && events.push({ name: a.name, sid }));
    mgr.setActiveFor('b', 'sess-1');
    mgr.setActiveFor('c', null);
    expect(events).toEqual([
      { name: 'b', sid: 'sess-1' },
      { name: 'c', sid: null },
    ]);
  });
});

describe('AgentManager — onAgentsChanged', () => {
  it('fires on setAgents even when active is unchanged', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    const snapshots: number[] = [];
    mgr.onAgentsChanged((s) => snapshots.push(s.primary.length));
    mgr.setAgents(
      [
        { name: 'a', description: '', tools: [], systemPrompt: '', type: 'primary' },
        { name: 'b', description: '', tools: [], systemPrompt: '', type: 'primary' },
        { name: 'd', description: '', tools: [], systemPrompt: '', type: 'primary' },
      ],
      [],
    );
    expect(mgr.getActiveFor(null)?.name).toBe('a');
    expect(snapshots).toEqual([3]);
  });

  it('unsubscribe stops notifications', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    const snapshots: number[] = [];
    const off = mgr.onAgentsChanged((s) => snapshots.push(s.primary.length));
    mgr.setAgents(PRIMARY, []);
    off();
    mgr.setAgents([], []);
    expect(snapshots).toEqual([3]);
  });
});
