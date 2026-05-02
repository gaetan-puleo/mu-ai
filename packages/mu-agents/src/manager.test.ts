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
  tmp = mkdtempSync(join(tmpdir(), 'mu-agent-mgr-'));
  settingsPath = join(tmp, 'state.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('AgentManager', () => {
  it('starts with first primary when no settings file', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    expect(mgr.getActive()?.name).toBe('a');
  });

  it('persists active agent to disk on switch', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    mgr.setActive('b');
    const persisted = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(persisted.currentAgent).toBe('b');
  });

  it('restores active agent from settings file', () => {
    const m1 = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    m1.setActive('c');
    const m2 = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    expect(m2.getActive()?.name).toBe('c');
  });

  it('falls back when persisted agent no longer exists', () => {
    const m1 = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    m1.setActive('c');
    const reduced = PRIMARY.filter((a) => a.name !== 'c');
    const m2 = new AgentManager({ primary: reduced, subagent: [], settingsPath });
    expect(m2.getActive()?.name).toBe('a');
  });

  it('cycle wraps around', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    mgr.cycle();
    expect(mgr.getActive()?.name).toBe('b');
    mgr.cycle();
    expect(mgr.getActive()?.name).toBe('c');
    mgr.cycle();
    expect(mgr.getActive()?.name).toBe('a');
  });

  it('notifies listeners on change but not on no-op setActive', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    const events: string[] = [];
    mgr.onChange((a) => a && events.push(a.name));
    mgr.setActive('b');
    mgr.setActive('b'); // no-op
    mgr.setActive('a');
    expect(events).toEqual(['b', 'a']);
  });

  it('returns false when switching to unknown agent', () => {
    const mgr = new AgentManager({ primary: PRIMARY, subagent: [], settingsPath });
    expect(mgr.setActive('missing')).toBe(false);
    expect(mgr.getActive()?.name).toBe('a');
  });

  it('exposes subagents as read-only list', () => {
    const sub: AgentDefinition[] = [{ name: 'review', description: '', tools: [], systemPrompt: '', type: 'subagent' }];
    const mgr = new AgentManager({ primary: PRIMARY, subagent: sub, settingsPath });
    expect(mgr.getSubagent('review')?.name).toBe('review');
    expect(mgr.getSubagent('missing')).toBeUndefined();
  });
});
