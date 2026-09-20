import { expect, test } from 'vitest';
import { parseSkill } from './parser';
import { validateDescription, validateName, validateSkill } from './spec';

test('validateName: valid slugs pass', () => {
  for (const n of ['pdf-processing', 'data-analysis', 'a', 'skill-2', 'a1-b2-c3']) {
    expect(validateName(n)).toEqual([]);
  }
});

test('validateName: rejects uppercase, hyphen edges, consecutive hyphens, bad chars, length', () => {
  expect(validateName('PDF-Processing').some((i) => i.message.includes('lowercase'))).toBe(true);
  expect(validateName('-pdf').some((i) => i.message.includes('start with a hyphen'))).toBe(true);
  expect(validateName('pdf-').some((i) => i.message.includes('end with a hyphen'))).toBe(true);
  expect(validateName('pdf--processing').some((i) => i.message.includes('consecutive hyphens'))).toBe(true);
  expect(validateName('pdf_processing').some((i) => i.message.includes('only contain'))).toBe(true);
  expect(validateName('x'.repeat(65)).some((i) => i.message.includes('at most 64'))).toBe(true);
  expect(validateName('')).toEqual([{ field: 'name', message: 'name is required' }]);
});

test('validateDescription: empty and oversized rejected', () => {
  expect(validateDescription('').length).toBe(1);
  expect(validateDescription('   ').length).toBe(1);
  expect(validateDescription('x'.repeat(1025)).some((i) => i.message.includes('at most 1024'))).toBe(true);
  expect(validateDescription('Extracts PDF text. Use when handling PDFs.')).toEqual([]);
});

test('parseSkill: captures required + optional spec fields', () => {
  const src = [
    '---',
    'name: pdf-processing',
    'description: Extract PDF text and merge files.',
    'license: Apache-2.0',
    'compatibility: Requires python3',
    'allowed-tools: Bash(git:*) Read',
    'metadata:',
    '  author: example-org',
    '  version: "1.0"',
    '---',
    '',
    '# Body',
    'Step by step instructions.',
  ].join('\n');
  const skill = parseSkill(src, 'pdf-processing');
  expect(skill.name).toBe('pdf-processing');
  expect(skill.description).toBe('Extract PDF text and merge files.');
  expect(skill.license).toBe('Apache-2.0');
  expect(skill.compatibility).toBe('Requires python3');
  expect(skill.allowedTools).toBe('Bash(git:*) Read');
  expect(skill.metadata).toEqual({ author: 'example-org', version: '1.0' });
  expect(skill.prompt).toContain('# Body');
});

test('parseSkill: falls back to dirName when name missing', () => {
  const skill = parseSkill('---\ndescription: x\n---\nbody', 'my-skill');
  expect(skill.name).toBe('my-skill');
});

test('validateSkill: dir mismatch and oversized compatibility flagged', () => {
  const skill = parseSkill('---\nname: other\ndescription: ok\ncompatibility: ' + 'c'.repeat(501) + '\n---\nbody', 'my-skill');
  const issues = validateSkill(skill, 'my-skill');
  expect(issues.some((i) => i.field === 'name' && i.message.includes('must match'))).toBe(true);
  expect(issues.some((i) => i.field === 'compatibility' && i.message.includes('at most 500'))).toBe(true);
});

test('validateSkill: a minimal valid skill has no issues', () => {
  const skill = parseSkill('---\nname: my-skill\ndescription: Does a thing.\n---\nDo it.', 'my-skill');
  expect(validateSkill(skill, 'my-skill')).toEqual([]);
});

test('validateSkill: missing description is invalid', () => {
  const skill = parseSkill('---\nname: my-skill\n---\nbody', 'my-skill');
  expect(validateSkill(skill, 'my-skill').some((i) => i.field === 'description')).toBe(true);
});
