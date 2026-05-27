import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { callTool } from './callTool';

describe('callTool', () => {
  it('should return result on success', async () => {
    const tool = {
      name: 'sum',
      description: 'Add two numbers',
      parameters: {},
      execute: () => '3',
      onError: () => 'error',
    };

    const result = await callTool(tool, '{"a":1,"b":2}');

    expect(result).toBe('3');
  });

  it('should return error string on synchronous failure', async () => {
    const tool = {
      name: 'sum',
      description: 'Add two numbers',
      parameters: {},
      execute: () => {
        throw new Error('calculation failed');
      },
      onError: (error: unknown) => `Tool error: ${error}`,
    };

    const result = await callTool(tool, '{}');

    expect(result).toBe('Tool error: Error: calculation failed');
  });

  it('should return error string on async failure', async () => {
    const tool = {
      name: 'fetch',
      description: 'Fetch URL',
      parameters: {},
      execute: async () => {
        throw new Error('network error');
      },
      onError: (error: unknown) => `Async error: ${error}`,
    };

    const result = await callTool(tool, '{"url":"http://example.com"}');

    expect(result).toBe('Async error: Error: network error');
  });

  it('routes invalid JSON args through onError', async () => {
    const tool = {
      name: 'sum',
      description: 'sum',
      parameters: {},
      execute: () => 'ok',
      onError: (error: unknown) => `bad args: ${(error as Error).message}`,
    };
    const result = await callTool(tool, 'not json');
    expect(result.startsWith('bad args: ')).toBe(true);
  });

  it('passes ctx.signal through to execute', async () => {
    let seen: AbortSignal | undefined;
    const tool = {
      name: 'spy',
      description: 'spy',
      parameters: {},
      execute: (_args: unknown, ctx?: { signal?: AbortSignal }) => {
        seen = ctx?.signal;
        return 'ok';
      },
    };
    const ctrl = new AbortController();
    const result = await callTool(tool, '{}', { signal: ctrl.signal });
    expect(result).toBe('ok');
    expect(seen).toBe(ctrl.signal);
  });

  it('falls back to a generic error when onError is omitted', async () => {
    const tool = {
      name: 'kaboom',
      description: 'kaboom',
      parameters: {},
      execute: () => {
        throw new Error('went sideways');
      },
    };
    const result = await callTool(tool, '{}');
    expect(result).toBe('Error: kaboom failed: went sideways');
  });
});
