import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { formatSkillInvocation, formatSkillsForSystemPrompt } from './system-prompt';
import type { Skill } from './types';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'review',
    description: 'Review the diff',
    content: 'Steps:\n1. git diff\n2. analyze',
    filePath: '/skills/review.md',
    ...overrides,
  };
}

describe('formatSkillsForSystemPrompt', () => {
  it('returns an empty string when no skills are loaded', () => {
    expect(formatSkillsForSystemPrompt([])).toBe('');
  });

  it('wraps every skill in an <available_skills> XML block', () => {
    const output = formatSkillsForSystemPrompt([
      makeSkill({ name: 'review', description: 'Review the diff' }),
      makeSkill({ name: 'run', description: 'Run the app' }),
    ]);
    expect(output).toBe(
      '<available_skills>\n' +
        '  <skill name="review">Review the diff</skill>\n' +
        '  <skill name="run">Run the app</skill>\n' +
        '</available_skills>',
    );
  });

  it('escapes XML metacharacters in name and description', () => {
    const output = formatSkillsForSystemPrompt([
      makeSkill({ name: 'tag<x>', description: 'a & b < c > d' }),
    ]);
    expect(output).toContain('name="tag&lt;x&gt;"');
    expect(output).toContain('a &amp; b &lt; c &gt; d');
  });
});

describe('formatSkillInvocation', () => {
  it('wraps the skill content with name and location attributes', () => {
    const out = formatSkillInvocation(makeSkill());
    expect(out).toBe(
      '<skill name="review" location="/skills/review.md">\nSteps:\n1. git diff\n2. analyze\n</skill>',
    );
  });

  it('appends additional instructions outside the skill block', () => {
    const out = formatSkillInvocation(makeSkill(), 'Focus on the new file');
    expect(out.endsWith('\n\nFocus on the new file')).toBe(true);
    expect(out).toContain('</skill>');
  });
});
