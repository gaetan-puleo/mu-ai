import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createInputHistory } from './input-history';

describe('createInputHistory', () => {
  it('returns undefined navigating with no entries', () => {
    const h = createInputHistory();
    expect(h.navigate('draft', 'up')).toBeUndefined();
  });

  it('walks up through entries from the bottom', () => {
    const h = createInputHistory({ initial: ['a', 'b', 'c'] });
    expect(h.navigate('draft', 'up')).toEqual({ text: 'c', isDraft: false });
    expect(h.navigate('draft', 'up')).toEqual({ text: 'b', isDraft: false });
    expect(h.navigate('draft', 'up')).toEqual({ text: 'a', isDraft: false });
  });

  it('clamps at the oldest entry', () => {
    const h = createInputHistory({ initial: ['only'] });
    expect(h.navigate('d', 'up')).toEqual({ text: 'only', isDraft: false });
    expect(h.navigate('d', 'up')).toEqual({ text: 'only', isDraft: false });
  });

  it('restores the draft when walking back below the bottom', () => {
    const h = createInputHistory({ initial: ['a', 'b'] });
    h.navigate('my-draft', 'up');
    h.navigate('my-draft', 'up');
    // back down
    expect(h.navigate('any', 'down')).toEqual({ text: 'b', isDraft: false });
    expect(h.navigate('any', 'down')).toEqual({ text: 'my-draft', isDraft: true });
  });

  it('returns undefined when going down without an active cursor', () => {
    const h = createInputHistory({ initial: ['a'] });
    expect(h.navigate('draft', 'down')).toBeUndefined();
  });

  it('push dedupes consecutive duplicates and notifies onAppend either way', () => {
    const appended: string[] = [];
    const h = createInputHistory({ onAppend: (t) => appended.push(t) });
    h.push('first');
    h.push('first');
    h.push('second');
    expect(h.size()).toBe(2);
    expect(appended).toEqual(['first', 'first', 'second']);
  });

  it('resetIfStale clears the cursor outside of withNavigation', () => {
    const h = createInputHistory({ initial: ['a'] });
    h.navigate('d', 'up');
    expect(h.hasActiveCursor()).toBe(true);
    h.resetIfStale();
    expect(h.hasActiveCursor()).toBe(false);
  });

  it('withNavigation suppresses resetIfStale calls', () => {
    const h = createInputHistory({ initial: ['a', 'b'] });
    h.navigate('d', 'up');
    h.withNavigation(() => {
      h.resetIfStale();
    });
    expect(h.hasActiveCursor()).toBe(true);
  });

  it('push clears the cursor', () => {
    const h = createInputHistory({ initial: ['a'] });
    h.navigate('d', 'up');
    h.push('newly-submitted');
    expect(h.hasActiveCursor()).toBe(false);
  });
});
