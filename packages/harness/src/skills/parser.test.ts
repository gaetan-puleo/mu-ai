import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { parseFrontmatter } from '../markdown';
import { parseSkill } from './parser';

describe('parseFrontmatter', () => {
  it('returns the original source as body when no frontmatter is present', () => {
    const { fields, body } = parseFrontmatter('# Just a heading\n\nbody');
    expect(fields).toEqual({});
    expect(body).toBe('# Just a heading\n\nbody');
  });

  it('parses key: value pairs between --- markers', () => {
    const { fields, body } = parseFrontmatter('---\nname: review\ndescription: Review the diff\n---\nbody here\n');
    expect(fields).toEqual({ name: 'review', description: 'Review the diff' });
    expect(body).toBe('body here\n');
  });

  it('unwraps single- and double-quoted values', () => {
    const { fields } = parseFrontmatter('---\nname: "code review"\nother: \'quoted\'\n---\n\nbody');
    expect(fields).toEqual({ name: 'code review', other: 'quoted' });
  });

  it('skips blank lines and frontmatter comments', () => {
    const { fields } = parseFrontmatter('---\n# a comment\nname: x\n\ndescription: y\n---\nbody');
    expect(fields).toEqual({ name: 'x', description: 'y' });
  });

  it('returns the source untouched when the closing marker is missing', () => {
    const src = '---\nname: x\n\nbody never closed';
    const { fields, body } = parseFrontmatter(src);
    expect(fields).toEqual({});
    expect(body).toBe(src);
  });
});

describe('parseSkill', () => {
  it('builds a Skill from valid frontmatter', () => {
    const skill = parseSkill({
      source: '---\nname: review\ndescription: Review the diff\n---\n\n# Steps\n1. ...\n',
      filePath: '/skills/review.md',
      fallbackName: 'fallback',
    });
    expect(skill).toEqual({
      name: 'review',
      description: 'Review the diff',
      content: '# Steps\n1. ...',
      filePath: '/skills/review.md',
    });
  });

  it('uses fallbackName when no name in frontmatter', () => {
    const skill = parseSkill({
      source: '---\ndescription: A skill\n---\nbody',
      filePath: '/skills/x.md',
      fallbackName: 'x',
    });
    expect(skill.name).toBe('x');
  });

  it('throws when description is missing', () => {
    expect(() =>
      parseSkill({
        source: '---\nname: x\n---\nbody',
        filePath: '/skills/x.md',
        fallbackName: 'x',
      })
    ).toThrow(/missing "description"/);
  });

  it('throws when both frontmatter name and fallback are empty', () => {
    expect(() =>
      parseSkill({
        source: 'no frontmatter, no anything',
        filePath: '/skills/x.md',
        fallbackName: '',
      })
    ).toThrow(/missing "name"/);
  });
});
