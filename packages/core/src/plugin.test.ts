import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { definePlugin } from './plugin';

describe('definePlugin', () => {
  it('creates a configurable plugin factory', () => {
    const createGitPlugin = definePlugin((config: { cwd: string }) => ({
      name: 'git',
      tools: {
        cwd: {
          name: 'cwd',
          description: 'Return cwd',
          parameters: {},
          execute: () => config.cwd,
          onError: () => 'failed',
        },
      },
    }));

    const plugin = createGitPlugin({ cwd: '/repo' });

    expect(plugin.name).toBe('git');
    expect(plugin.tools?.cwd.execute('{}')).toBe('/repo');
  });

  it('preserves no-config plugin factories', () => {
    const createSimplePlugin = definePlugin(() => ({ name: 'simple' }));

    expect(createSimplePlugin()).toEqual({ name: 'simple' });
  });
});
