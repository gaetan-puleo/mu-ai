import { describe, expect, it } from 'bun:test';
import type { Plugin } from '../plugin';
import { startMu } from './index';

function makePlugin(name: string, marks: string[]): Plugin {
  return {
    name,
    activate() {
      marks.push(`activate:${name}`);
    },
  };
}

describe('startMu', () => {
  it('activates code-passed plugins in order', async () => {
    const marks: string[] = [];
    const handle = await startMu({
      plugins: [makePlugin('a', marks), makePlugin('b', marks)],
    });
    expect(marks).toEqual(['activate:a', 'activate:b']);
    await handle.shutdown();
  });

  it('exposes provider/channel/activity/sessions registries', async () => {
    const handle = await startMu({});
    expect(handle.providers.list()).toEqual([]);
    expect(handle.channels.list()).toEqual([]);
    expect(handle.sessions.list()).toEqual([]);
    expect(typeof handle.activity.emit).toBe('function');
    await handle.shutdown();
  });

  it('config-listed plugins are activated before code-passed', async () => {
    const marks: string[] = [];
    const cfgPlugin = makePlugin('cfg', marks);
    const codePlugin = makePlugin('code', marks);
    const handle = await startMu({
      config: { plugins: ['cfg'] },
      plugins: [codePlugin],
      resolvePlugin: async (entry) => (typeof entry === 'string' && entry === 'cfg' ? cfgPlugin : null),
    });
    expect(marks).toEqual(['activate:cfg', 'activate:code']);
    await handle.shutdown();
  });

  it('starts all registered channels', async () => {
    const startMarks: string[] = [];
    const handle = await startMu({
      plugins: [
        {
          name: 'chan-plugin',
          activate(ctx) {
            ctx.channels?.register({
              id: 'test',
              async start() {
                startMarks.push('started');
              },
            });
          },
        },
      ],
    });
    expect(startMarks).toEqual(['started']);
    await handle.shutdown();
  });
});
