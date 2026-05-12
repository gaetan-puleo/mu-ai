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
    const runtime = await startMu({
      plugins: [makePlugin('a', marks), makePlugin('b', marks)],
    });
    expect(marks).toEqual(['activate:a', 'activate:b']);
    await runtime.shutdown();
  });

  it('exposes all registries on the runtime', async () => {
    const runtime = await startMu({});
    expect(runtime.providers.list()).toEqual([]);
    expect(runtime.channels.list()).toEqual([]);
    expect(runtime.sessions.list()).toEqual([]);
    expect(typeof runtime.activity.emit).toBe('function');
    expect(typeof runtime.submitText).toBe('function');
    expect(typeof runtime.submitCommand).toBe('function');
    await runtime.shutdown();
  });

  it('config-listed plugins are activated before code-passed', async () => {
    const marks: string[] = [];
    const cfgPlugin = makePlugin('cfg', marks);
    const codePlugin = makePlugin('code', marks);
    const runtime = await startMu({
      config: { plugins: ['cfg'] },
      plugins: [codePlugin],
      resolvePlugin: async (entry) => (typeof entry === 'string' && entry === 'cfg' ? cfgPlugin : null),
    });
    expect(marks).toEqual(['activate:cfg', 'activate:code']);
    await runtime.shutdown();
  });

  it('starts all registered channels via runtime.start()', async () => {
    const startMarks: string[] = [];
    const runtime = await startMu({
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
    // Channels are NOT auto-started; host calls runtime.start().
    expect(startMarks).toEqual([]);
    await runtime.start();
    expect(startMarks).toEqual(['started']);
    await runtime.shutdown();
  });

  it('submitCommand dispatches to registered slash commands', async () => {
    const runtime = await startMu({
      plugins: [
        {
          name: 'cmd-plugin',
          commands: [
            {
              name: 'greet',
              description: 'say hello',
              execute: async (args) => `hello ${args}`,
            },
          ],
        },
      ],
    });
    const result = await runtime.submitCommand({ sessionId: 's1', commandName: 'greet', args: 'world' });
    expect(result).toEqual({ kind: 'executed', output: 'hello world' });

    const missing = await runtime.submitCommand({ sessionId: 's1', commandName: 'nope', args: '' });
    expect(missing).toEqual({ kind: 'not_found' });
    await runtime.shutdown();
  });
});
