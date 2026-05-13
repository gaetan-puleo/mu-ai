import { describe, expect, it } from 'bun:test';
import { createCodingAgentsPlugin, getCodingAgentsDir } from './plugin';

describe('mu-coding-agents plugin', () => {
  it('exposes the right name', () => {
    const p = createCodingAgentsPlugin();
    expect(p.name).toBe('mu-coding-agents');
  });

  it('exposes the agents directory path', () => {
    const dir = getCodingAgentsDir();
    expect(dir).toMatch(/agents$/);
  });
});
