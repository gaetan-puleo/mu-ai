import { useApp } from 'ink';
import type { SubagentRunRegistry } from 'mu-agents';
import {
  type ChatMessage,
  createSessionManager,
  type PluginRegistry,
  type ProviderConfig,
  type SessionManager,
} from 'mu-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ShutdownFn } from '../../app/shutdown';
import type { SessionPathHolder } from '../../runtime/createRegistry';
import type { HostMessageBus } from '../../runtime/messageBus';
import { listSessionsAsync, type SessionInfo } from '../../sessions/index';
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
  sessions: SessionInfo[];
  registry: PluginRegistry;
  uiService?: InkUIService;
  messageBus?: HostMessageBus;
  subagentRuns?: SubagentRunRegistry;
}

export function useChat(
  config: ProviderConfig,
  registry: PluginRegistry,
  initialMessages?: ChatMessage[],
  shutdown?: ShutdownFn,
  uiService?: InkUIService,
  messageBus?: HostMessageBus,
  sessionPathHolder?: SessionPathHolder,
  subagentRuns?: SubagentRunRegistry,
): ChatContextValue {
  const { exit } = useApp();
  const controllerRef = useRef<AbortController | null>(null);
  const attachment = useAttachment();
  const toggles = useToggles();
  const models = useModelList(config.baseUrl, config.model);
  // Stable SessionManager + Session for the lifetime of the chat hook. Model
  // updates flow through `runTurn(options)` per call, so we don't need to
  // re-instantiate on every change.
  const sessionManager = useMemo(
    () => createSessionManager({ registry, config, model: models.currentModel || config.model || 'unknown' }),
    [registry, config, models.currentModel],
  );
  const muSession = useMemo(
    () => sessionManager.getOrCreate('tui', { initialMessages }),
    [sessionManager, initialMessages],
  );
  const session = useChatSession({
    session: muSession,
    config,
    currentModel: models.currentModel,
    attachment,
    controllerRef,
    initialMessages,
    registry,
    messageBus,
    sessionPathHolder,
  });
  const abort = useAbort(session.streaming, controllerRef, exit, ABORT_TIMEOUT_MS, shutdown);

  // Stream the session list asynchronously when the picker opens. Empty until
  // the first listing settles; subsequent opens hit the in-memory peek cache
  // so they're effectively instant.
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  useEffect(() => {
    if (!toggles.showSessionPicker) {
      setSessions([]);
      return;
    }
    let cancelled = false;
    listSessionsAsync()
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [toggles.showSessionPicker]);

  return {
    config,
    session,
    sessionManager,
    toggles,
    attachment,
    models,
    abort,
    sessions,
    registry,
    uiService,
    messageBus,
    subagentRuns,
  };
}
