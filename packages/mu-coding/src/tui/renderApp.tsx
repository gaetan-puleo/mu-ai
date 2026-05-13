import { render } from 'ink';
import type { AgentsHandle } from 'mu-agents';
import type { Command, Session } from 'mu-core';
import { useEffect } from 'react';
import type { SessionSummary } from '../store';
import { _setMuCodingTUI, type MuCodingTUI } from './api';
import { App } from './components/App';
import { setDispatch } from './dispatchSlot';
import { AppProvider, useDispatch } from './state/AppContext';
import { ThemeProvider } from './theme/ThemeContext';

export interface MountOptions {
  session: Session;
  model?: string;
  agents?: AgentsHandle;
  submit: (text: string) => Promise<void>;
  abort: () => void;
  commands: () => readonly Command[];
  listSessions: () => SessionSummary[];
  switchSession: (id: string) => void;
  setModel: (model: string) => void;
}

export interface MountedTui {
  waitUntilExit: () => Promise<void>;
  unmount: () => void;
}

export function mountTui(opts: MountOptions): MountedTui {
  const instance = render(
    <ThemeProvider>
      <AppProvider
        session={opts.session}
        agents={opts.agents}
        model={opts.model}
        submit={opts.submit}
        abort={opts.abort}
      >
        <DispatchBridge />
        <App
          commands={opts.commands}
          listSessions={opts.listSessions}
          switchSession={opts.switchSession}
          setModel={opts.setModel}
        />
      </AppProvider>
    </ThemeProvider>,
    { exitOnCtrlC: true },
  );

  return {
    waitUntilExit: async () => {
      await instance.waitUntilExit();
    },
    unmount: () => {
      setDispatch(undefined);
      _setMuCodingTUI(undefined);
      instance.unmount();
    },
  };
}

/**
 * Mounts the React-side dispatch into the global slot and installs the
 * plugin-facing TUI API. Renders nothing.
 */
function DispatchBridge() {
  const dispatch = useDispatch();

  useEffect(() => {
    setDispatch(dispatch);
    const api: MuCodingTUI = {
      shortcut: () => () => {},
      setStatus: (key, segments) => dispatch({ type: 'status_set', key, segments }),
      clearStatus: (key) => dispatch({ type: 'status_clear', key }),
      notify: (message, level = 'info') =>
        dispatch({
          type: 'toast_push',
          toast: {
            id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            message,
            level,
          },
        }),
      renderer: () => () => {},
    };
    _setMuCodingTUI(api);
    return () => {
      setDispatch(undefined);
      _setMuCodingTUI(undefined);
    };
  }, [dispatch]);

  return null;
}
