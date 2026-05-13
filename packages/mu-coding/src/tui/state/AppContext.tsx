import type { AgentsHandle } from 'mu-agents';
import type { Session } from 'mu-core';
import { createContext, type Dispatch, type ReactNode, useContext, useReducer } from 'react';
import { type Action, initialUiState, reducer, type UiState } from './uiStore';

export interface AppContextValue {
  state: UiState;
  dispatch: Dispatch<Action>;
  session: Session;
  agents?: AgentsHandle;
  submit: (text: string) => Promise<void>;
  abort: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export interface AppProviderProps {
  session: Session;
  agents?: AgentsHandle;
  model?: string;
  submit: (text: string) => Promise<void>;
  abort: () => void;
  children: ReactNode;
}

export function AppProvider({ session, agents, model, submit, abort, children }: AppProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialUiState(session.id, model));
  return (
    <AppContext.Provider value={{ state, dispatch, session, agents, submit, abort }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used within AppProvider');
  return v;
}

export function useUi(): UiState {
  return useApp().state;
}

export function useDispatch(): Dispatch<Action> {
  return useApp().dispatch;
}
