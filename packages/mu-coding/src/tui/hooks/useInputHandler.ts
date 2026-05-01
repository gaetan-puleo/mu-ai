import { type Key, useInput, useStdin } from 'ink';
import type { SlashCommand as PluginSlashCommand } from 'mu-agents';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchCommands, type SlashCommand } from '../commands';

const BACKSPACE_BYTES = new Set(['\x7f', '\x08']);

export interface InputActions {
  onCtrlC?: () => void;
  onPaste?: () => void;
  onNew?: () => void;
  onCycleModel?: () => void;
  onTogglePicker?: () => void;
  onToggleSessionPicker?: () => void;
  onEsc?: () => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  modelCount?: number;
}

interface InputState {
  value: string;
  commands: SlashCommand[];
  cmdIndex: number;
  isCommandMode: boolean;
}

interface UseInputHandlerOptions {
  isActive: boolean;
  streaming: boolean;
  history: string[];
  actions: InputActions;
  onSubmit: (text: string) => void;
  pluginCommands?: PluginSlashCommand[];
}

// Build a stable key identifier from an Ink key event
function keyId(input: string, key: Key): string | null {
  if (key.ctrl && key.shift && input) {
    return `ctrl+shift+${input}`;
  }
  if (key.ctrl && input) {
    return `ctrl+${input}`;
  }
  if (key.escape) {
    return 'escape';
  }
  if (key.pageUp) {
    return 'pageup';
  }
  if (key.pageDown) {
    return 'pagedown';
  }
  if (key.return) {
    return key.shift ? 'shift+return' : 'return';
  }
  if (key.tab) {
    return 'tab';
  }
  if (key.upArrow) {
    return 'up';
  }
  if (key.downArrow) {
    return 'down';
  }
  if (key.backspace || key.delete) {
    return 'backspace';
  }
  return null;
}

function useHistoryNavigation(value: string, history: string[]) {
  const idx = useRef(-1);
  const draft = useRef('');

  const up = (): string | null => {
    if (!history.length) {
      return null;
    }
    if (idx.current === -1) {
      draft.current = value;
      idx.current = history.length - 1;
    } else if (idx.current > 0) {
      idx.current -= 1;
    }
    return history[idx.current] ?? null;
  };

  const down = (): string | null => {
    if (idx.current === -1) {
      return null;
    }
    if (idx.current < history.length - 1) {
      idx.current += 1;
      return history[idx.current] ?? null;
    }
    idx.current = -1;
    return draft.current;
  };

  return { up, down, reset: () => (idx.current = -1) };
}

function useRawBackspace(isActive: boolean, setValue: (fn: (p: string) => string) => void) {
  const { stdin } = useStdin();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!(stdin && isActive)) {
      return;
    }
    const onData = (data: Buffer) => {
      if (BACKSPACE_BYTES.has(data.toString())) {
        handledRef.current = true;
        setValue((p) => p.slice(0, -1));
      }
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin, isActive, setValue]);

  return handledRef;
}

const COMMAND_ACTIONS: Record<string, keyof InputActions> = {
  model: 'onTogglePicker',
  sessions: 'onToggleSessionPicker',
  new: 'onNew',
};

interface BindingCtx {
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  setCmdIndex: React.Dispatch<React.SetStateAction<number>>;
  nav: ReturnType<typeof useHistoryNavigation>;
  submit: () => void;
  isCommandMode: boolean;
  commands: SlashCommand[];
  actions: InputActions;
}

type Binding = (ctx: BindingCtx) => void;

const BINDINGS: Record<string, Binding> = {
  'ctrl+c': (c) => c.actions.onCtrlC?.(),
  'ctrl+v': (c) => c.actions.onPaste?.(),
  'ctrl+o': (c) => c.actions.onTogglePicker?.(),
  'ctrl+s': (c) => c.submit(),
  'ctrl+j': (c) => c.setValue((p) => `${p}\n`),
  'ctrl+m': (c) => {
    if (c.actions.modelCount) {
      c.actions.onCycleModel?.();
    }
  },
  'ctrl+n': (c) => {
    c.actions.onNew?.();
    c.setValue('');
    c.nav.reset();
  },
  escape: (c) => c.actions.onEsc?.(),
  pageup: (c) => c.actions.onScrollUp?.(),
  pagedown: (c) => c.actions.onScrollDown?.(),
  'shift+return': (c) => c.setValue((p) => `${p}\n`),
  return: (c) => c.submit(),
  tab: (c) => c.setValue((p) => `${p}  `),
  up: (c) => {
    if (c.isCommandMode) {
      c.setCmdIndex((i) => (i > 0 ? i - 1 : c.commands.length - 1));
      return;
    }
    const r = c.nav.up();
    if (r !== null) {
      c.setValue(r);
    }
  },
  down: (c) => {
    if (c.isCommandMode) {
      c.setCmdIndex((i) => (i < c.commands.length - 1 ? i + 1 : 0));
      return;
    }
    const r = c.nav.down();
    if (r !== null) {
      c.setValue(r);
    }
  },
};

function handleBackspace(c: BindingCtx, alreadyHandled: boolean) {
  if (!alreadyHandled) {
    c.setValue((p) => p.slice(0, -1));
  }
  c.nav.reset();
}

function handleInsert(input: string, c: BindingCtx) {
  if (input && input.length === 1) {
    c.setValue((p) => p + input);
    c.nav.reset();
  }
}

function executeCommand(cmd: SlashCommand, args: string, actions: InputActions): void {
  if (cmd.execute) {
    cmd.execute(args);
  } else if (cmd.action) {
    const actionKey = COMMAND_ACTIONS[cmd.action];
    if (actionKey) {
      (actions[actionKey] as (() => void) | undefined)?.();
    }
  }
}

export function useInputHandler(options: UseInputHandlerOptions): InputState {
  const { isActive, streaming, history, actions, onSubmit, pluginCommands } = options;
  const [value, setValue] = useState('');
  const [cmdIndex, setCmdIndex] = useState(0);
  const nav = useHistoryNavigation(value, history);
  const backspaceHandledRef = useRawBackspace(isActive, setValue);

  const commands = useMemo(() => matchCommands(value.trim(), pluginCommands), [value, pluginCommands]);
  const isCommandMode = commands.length > 0 && value.trim().startsWith('/');

  const submit = useCallback(() => {
    if (streaming) {
      return;
    }
    if (isCommandMode) {
      const cmd = commands[cmdIndex];
      if (cmd) {
        const args = value.trim().slice(cmd.name.length).trim();
        setValue('');
        executeCommand(cmd, args, actions);
      }
      return;
    }
    if (!value.trim()) {
      return;
    }
    onSubmit(value);
    setValue('');
    nav.reset();
  }, [streaming, isCommandMode, commands, cmdIndex, value, actions, onSubmit, nav]);

  useInput(
    (input, key) => {
      const alreadyHandled = backspaceHandledRef.current;
      backspaceHandledRef.current = false;

      const ctx: BindingCtx = { value, setValue, setCmdIndex, nav, submit, isCommandMode, commands, actions };
      const id = keyId(input, key);

      if (id === 'backspace') {
        handleBackspace(ctx, alreadyHandled);
        return;
      }
      if (id && BINDINGS[id]) {
        BINDINGS[id](ctx);
        return;
      }
      handleInsert(input, ctx);
    },
    { isActive },
  );

  return { value, commands, cmdIndex, isCommandMode };
}
