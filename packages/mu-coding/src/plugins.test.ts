import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { assemblePlugins } from './plugins';

let stderrBuf = '';
const ORIGINAL_WRITE = process.stderr.write.bind(process.stderr);

beforeEach(() => {
  stderrBuf = '';
  // biome-ignore lint/suspicious/noExplicitAny: stubbing a node stream method
  (process.stderr as any).write = (chunk: unknown) => {
    stderrBuf += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  };
});

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: restoring stubbed method
  (process.stderr as any).write = ORIGINAL_WRITE;
});

const pluginNames = (plugins: { name: string }[]) => plugins.map((p) => p.name);

describe('assemblePlugins', () => {
  it('empty configPlugins → just provider + mu-tools', () => {
    const { plugins, agentsHandle, localProviderHandle } = assemblePlugins({ configPlugins: [] });
    expect(pluginNames(plugins)).toEqual(['mu-local-provider', 'mu-tools']);
    expect(agentsHandle).toBeUndefined();
    expect(localProviderHandle).toBeDefined();
    expect(stderrBuf).toBe('');
  });

  it('happy path: both agents plugins listed → correct order, handle exposed', () => {
    const { plugins, agentsHandle } = assemblePlugins({
      configPlugins: ['mu-coding-agents', 'mu-agents'],
    });
    expect(pluginNames(plugins)).toEqual(['mu-local-provider', 'mu-tools', 'mu-coding-agents', 'mu-agents']);
    expect(agentsHandle).toBeDefined();
  });

  it('mu-coding-agents alone → warns and skips both', () => {
    const { plugins, agentsHandle } = assemblePlugins({
      configPlugins: ['mu-coding-agents'],
    });
    expect(pluginNames(plugins)).toEqual(['mu-local-provider', 'mu-tools']);
    expect(agentsHandle).toBeUndefined();
    expect(stderrBuf).toContain('"mu-coding-agents" requires "mu-agents"');
  });

  it('mu-agents alone → wires it but warns about no provider', () => {
    const { plugins, agentsHandle } = assemblePlugins({ configPlugins: ['mu-agents'] });
    expect(pluginNames(plugins)).toEqual(['mu-local-provider', 'mu-tools', 'mu-agents']);
    expect(agentsHandle).toBeDefined();
    expect(stderrBuf).toContain('no agents will be available');
  });

  it('"mu-tools" listed → warned and dropped (always on)', () => {
    const { plugins } = assemblePlugins({ configPlugins: ['mu-tools'] });
    // mu-tools is still in the result — but registered unconditionally, not
    // because the user listed it.
    expect(pluginNames(plugins).filter((n) => n === 'mu-tools')).toHaveLength(1);
    expect(stderrBuf).toContain('"mu-tools" is always enabled');
  });

  it('unknown name → warned and dropped', () => {
    const { plugins } = assemblePlugins({ configPlugins: ['bogus'] });
    expect(pluginNames(plugins)).toEqual(['mu-local-provider', 'mu-tools']);
    expect(stderrBuf).toContain('unknown plugin "bogus"');
  });
});
