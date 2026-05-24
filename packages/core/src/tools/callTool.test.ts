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

    const result = await callTool(tool, '1 2');

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

    const result = await callTool(tool, '1 2');

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

    const result = await callTool(tool, 'http://example.com');

    expect(result).toBe('Async error: Error: network error');
  });
});
