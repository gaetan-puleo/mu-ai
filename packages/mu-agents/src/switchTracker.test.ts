import { describe, expect, it } from 'bun:test';
import { buildAgentSwitchNote, createAgentSwitchTracker, recordSwitch, resetTracker } from './switchTracker';

describe('AgentSwitchTracker — recording', () => {
  it('starts empty, no note when no traversal', () => {
    const t = createAgentSwitchTracker();
    recordSwitch(t, 'a'); // first observation, just sets current
    expect(t.current).toBe('a');
    expect(t.traversed).toEqual([]);
    expect(buildAgentSwitchNote(t, 'a')).toBeNull();
  });

  it('records the previous agent on switch and builds a note', () => {
    const t = createAgentSwitchTracker();
    recordSwitch(t, 'a');
    recordSwitch(t, 'b');
    expect(t.current).toBe('b');
    expect(t.traversed).toEqual(['a']);
    const note = buildAgentSwitchNote(t, 'b');
    expect(note).not.toBeNull();
    expect(note).toContain("'a'");
    expect(note).toContain("agent 'b'");
  });

  it('preserves chronological order across multiple switches without dedup loss', () => {
    const t = createAgentSwitchTracker();
    recordSwitch(t, 'a');
    recordSwitch(t, 'b');
    recordSwitch(t, 'c');
    recordSwitch(t, 'a'); // back to a — current changes, b and c remain in traversed
    expect(t.current).toBe('a');
    expect(t.traversed).toEqual(['a', 'b', 'c']);
    // Note filters out the current name, so only b and c surface.
    const note = buildAgentSwitchNote(t, 'a');
    expect(note).toContain("'b'");
    expect(note).toContain("'c'");
    expect(note).not.toContain("'a',");
  });

  it('deduplicates consecutive identical recordSwitch calls (no-op)', () => {
    const t = createAgentSwitchTracker();
    recordSwitch(t, 'a');
    recordSwitch(t, 'a');
    recordSwitch(t, 'a');
    expect(t.traversed).toEqual([]);
    expect(t.current).toBe('a');
  });

  it('does not duplicate an agent already in traversed', () => {
    const t = createAgentSwitchTracker();
    recordSwitch(t, 'a');
    recordSwitch(t, 'b');
    recordSwitch(t, 'a');
    recordSwitch(t, 'b');
    expect(t.traversed).toEqual(['a', 'b']);
  });
});

describe('AgentSwitchTracker — note + reset', () => {
  it('returns null when the only traversed agent is the current one', () => {
    const t = createAgentSwitchTracker();
    recordSwitch(t, 'a');
    recordSwitch(t, 'b');
    recordSwitch(t, 'a'); // back to a; traversed = [a, b]
    // From the perspective of a sending now, only b should be reported.
    // From the perspective of b sending: only a.
    expect(buildAgentSwitchNote(t, 'a')).toContain("'b'");
    expect(buildAgentSwitchNote(t, 'a')).not.toContain("'a',");
  });

  it('resetTracker clears traversal but seeds current', () => {
    const t = createAgentSwitchTracker();
    recordSwitch(t, 'a');
    recordSwitch(t, 'b');
    resetTracker(t, 'b');
    expect(t.traversed).toEqual([]);
    expect(t.current).toBe('b');
    expect(buildAgentSwitchNote(t, 'b')).toBeNull();
  });

  it('after a send-cycle (reset to current), only NEW switches drive the next note', () => {
    const t = createAgentSwitchTracker();
    recordSwitch(t, 'a');
    recordSwitch(t, 'b'); // user switched a -> b without sending
    // Simulate user sending: produce note, then reset to current.
    expect(buildAgentSwitchNote(t, 'b')).toContain("'a'");
    resetTracker(t, 'b');
    // No new switches → next send must NOT produce a note.
    expect(buildAgentSwitchNote(t, 'b')).toBeNull();
    // Now switch b -> c, send: should mention only b.
    recordSwitch(t, 'c');
    const note = buildAgentSwitchNote(t, 'c');
    expect(note).toContain("'b'");
    expect(note).not.toContain("'a'");
  });
});
