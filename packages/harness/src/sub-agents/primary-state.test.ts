import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createPrimaryAgentState } from './primary-state';
import type { SubAgent } from './types';

const make = (name: string): SubAgent => ({
  name,
  description: '',
  prompt: '',
  tools: ['*'],
  permissions: [],
  type: 'primary',
  filePath: `${name}.md`,
});

describe('createPrimaryAgentState', () => {
  it('defaults active to the first agent when no initial name is given', () => {
    const a = make('build');
    const b = make('plan');
    const state = createPrimaryAgentState({ agents: [a, b] });
    expect(state.active()).toBe(a);
    expect(state.effective()).toBe(a);
  });

  it('restores active from initialName when present', () => {
    const a = make('build');
    const b = make('plan');
    const state = createPrimaryAgentState({ agents: [a, b], initialName: 'plan' });
    expect(state.active()).toBe(b);
  });

  it('falls back to the first agent when initialName is unknown', () => {
    const a = make('build');
    const state = createPrimaryAgentState({ agents: [a], initialName: 'gone' });
    expect(state.active()).toBe(a);
  });

  it('setActive looks up by name and fires onActiveChange', () => {
    const a = make('build');
    const b = make('plan');
    const changes: string[] = [];
    const state = createPrimaryAgentState({
      agents: [a, b],
      onActiveChange: (name) => changes.push(name),
    });
    state.setActive('plan');
    expect(state.active()).toBe(b);
    expect(changes).toEqual(['plan']);

    state.setActive('plan');
    expect(changes).toEqual(['plan']); // no change → no fire

    state.setActive('ghost');
    expect(state.active()).toBe(b);
    expect(changes).toEqual(['plan']);
  });

  it('override masks active for `effective`, clears on undefined', () => {
    const a = make('build');
    const b = make('plan');
    const state = createPrimaryAgentState({ agents: [a, b] });
    state.setOverride(b);
    expect(state.effective()).toBe(b);
    expect(state.active()).toBe(a);
    state.setOverride(undefined);
    expect(state.effective()).toBe(a);
  });

  it('ignores override agents not in the registered list', () => {
    const a = make('build');
    const state = createPrimaryAgentState({ agents: [a] });
    state.setOverride(make('foreign'));
    expect(state.override()).toBeUndefined();
  });
});
