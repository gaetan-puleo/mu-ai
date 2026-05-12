import { describe, expect, it } from 'bun:test';
import { capitalizeAgentName } from './displayName';

describe('capitalizeAgentName', () => {
  it('uppercases the first letter', () => {
    expect(capitalizeAgentName('arya')).toBe('Arya');
    expect(capitalizeAgentName('review')).toBe('Review');
  });

  it('preserves the rest of the string', () => {
    expect(capitalizeAgentName('plan-mode')).toBe('Plan-mode');
  });

  it('returns the input unchanged when empty', () => {
    expect(capitalizeAgentName('')).toBe('');
  });

  it('handles already-capitalized names', () => {
    expect(capitalizeAgentName('Arya')).toBe('Arya');
  });
});
