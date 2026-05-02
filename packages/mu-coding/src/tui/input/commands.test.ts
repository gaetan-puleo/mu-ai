import { describe, expect, it, mock } from 'bun:test';
import { BUILTIN_COMMANDS, fromPluginCommand, matchCommands } from './commands';
import type { InputActions } from './useInputHandler';

describe('matchCommands', () => {
  it('returns no matches for input that does not start with /', () => {
    expect(matchCommands('model', BUILTIN_COMMANDS)).toEqual([]);
  });

  it('filters by prefix case-insensitively', () => {
    const result = matchCommands('/MOD', BUILTIN_COMMANDS);
    expect(result.map((c) => c.name)).toEqual(['/model']);
  });

  it('returns all commands when input is just /', () => {
    const result = matchCommands('/', BUILTIN_COMMANDS);
    expect(result.length).toBe(BUILTIN_COMMANDS.length);
  });
});

describe('BUILTIN_COMMANDS', () => {
  it('each builtin invokes the expected action', () => {
    const onTogglePicker = mock(() => undefined);
    const onToggleSessionPicker = mock(() => undefined);
    const onNew = mock(() => undefined);
    const onCompact = mock(() => undefined);
    const onShowContext = mock(() => undefined);
    const onUpdate = mock(() => undefined);
    const actions: InputActions = {
      onTogglePicker,
      onToggleSessionPicker,
      onNew,
      onCompact,
      onShowContext,
      onUpdate,
    };

    for (const cmd of BUILTIN_COMMANDS) {
      cmd.invoke?.(actions, '');
    }

    expect(onTogglePicker).toHaveBeenCalledTimes(1);
    expect(onToggleSessionPicker).toHaveBeenCalledTimes(1);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(onShowContext).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('/update forwards args to onUpdate', () => {
    const onUpdate = mock(() => undefined);
    const actions: InputActions = { onUpdate };
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === '/update');
    expect(cmd).toBeDefined();
    cmd?.invoke?.(actions, 'plugins');
    expect(onUpdate).toHaveBeenCalledWith('plugins');
  });
});

describe('fromPluginCommand', () => {
  it('prepends a slash and forwards args/context to execute', async () => {
    const execute = mock(async () => 'ok');
    const wrapped = fromPluginCommand(
      { name: 'foo', description: 'plugin', execute },
      { messages: [], cwd: '/tmp', config: { baseUrl: '', maxTokens: 0, temperature: 0, streamTimeoutMs: 0 } },
    );
    expect(wrapped.name).toBe('/foo');
    await wrapped.execute?.('hello');
    expect(execute).toHaveBeenCalledWith('hello', expect.any(Object));
  });
});
