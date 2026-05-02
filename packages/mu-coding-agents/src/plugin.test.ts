import { describe, expect, it } from 'bun:test';
import { createCodingAgentsPlugin } from './plugin';

describe('mu-coding-agents plugin', () => {
  it('exposes the right name + version', () => {
    const p = createCodingAgentsPlugin();
    expect(p.name).toBe('mu-coding-agents');
    expect(p.version).toBe('0.5.0');
  });

  it('registers a source on activate', async () => {
    const p = createCodingAgentsPlugin();
    const registered: string[] = [];
    await p.activate?.({
      cwd: process.cwd(),
      config: {},
      agents: {
        registerSource(dir) {
          registered.push(dir);
          return () => {
            /* unregister */
          };
        },
      },
    } as Parameters<NonNullable<typeof p.activate>>[0]);
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatch(/agents$/);
  });
});
