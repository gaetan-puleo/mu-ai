import { useApp } from 'ink';
import type { SubagentRunRegistry } from 'mu-agents';
import type {
  ChatMessage,
  PluginRegistry,
  ProviderConfig,
  SessionManager,
  SessionStore,
  SessionSummary,
  SubmitTextInput,
  SubmitTextResult,
} from 'mu-core';
import { newSessionId } from 'mu-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ShutdownFn } from '../../app/shutdown';
import type { InkUIService } from '../plugins/InkUIService';
import { type AbortState, useAbort } from './useAbort';
import { type AttachmentState, type TogglesState, useAttachment, useToggles } from './useAttachment';
import { type ChatSessionState, useChatSession } from './useChatSession';
import { type ModelListState, useModelList } from './useModels';

const ABORT_TIMEOUT_MS = 2000;

export interface ChatContextValue {
  config: ProviderConfig;
  session: ChatSessionState;
  sessionManager: SessionManager;
  toggles: TogglesState;
  attachment: AttachmentState;
  models: ModelListState;
  abort: AbortState;
  sessions: SessionSummary[];
  registry: PluginRegistry;
  uiService?: InkUIService;
  subagentRuns?: SubagentRunRegistry;
}

interface UseChatOptions {
  config: ProviderConfig;
  initialSessionId: string;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  sessions: SessionManager;
  store: SessionStore;
  submitText: (input: SubmitTextInput) => Promise<SubmitTextResult>;
  shutdown?: ShutdownFn;
  uiService?: InkUIService;
  subagentRuns?: SubagentRunRegistry;
}

export function useChat(options: UseChatOptions): ChatContextValue {
  const {
    config, initialSessionId, initialMessages, registry, sessions: sessionManager,
    store, submitText, shutdown, uiService, subagentRuns,
  } = options;

  const { exit } = useApp();
  const attachment = useAttachment();
  const toggles = useToggles();
  const models = useModelList(config.baseUrl, config.model);

  const [currentSessionId, setCurrentSessionId] = useState(initialSessionId);

  const muSession = useMemo(
    () => sessionManager.getOrCreate(currentSessionId, { initialMessages }),
    [sessionManager, currentSessionId, initialMessages],
  );

  const session = useChatSession({
    session: muSession,
    config,
    currentModel: models.currentModel,
    attachment,
    submitText,
    initialMessages,
  });

  const abort = useAbort(session.streaming, muSession, exit, ABORT_TIMEOUT_MS, shutdown);

  // Session list from the store — refreshed when the picker opens.
  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  useEffect(() => {
    if (!toggles.showSessionPicker) {
      setSessionList([]);
      return;
    }
    setSessionList(store.list());
  }, [toggles.showSessionPicker, store]);

  // /new: generate a fresh session id, wipe state.
  const onNew = useCallback(() => {
    muSession.abort();
    const freshId = newSessionId();
    setCurrentSessionId(freshId);
    session.resetMessages();
  }, [muSession, session]);

  // Load from picker: switch to the stored session id.
  const onLoadSession = useCallback(
    (sessionId: string) => {
      const stored = store.get(sessionId);
      if (!stored || stored.messages.length === 0) return;
      muSession.abort();
      setCurrentSessionId(sessionId);
    },
    [store, muSession],
  );

  return {
    config,
    session: {
      ...session,
      onNew,
      onLoadSession,
    },
    sessionManager,
    toggles,
    attachment,
    models,
    abort,
    sessions: sessionList,
    registry,
    uiService,
    subagentRuns,
  };
}
