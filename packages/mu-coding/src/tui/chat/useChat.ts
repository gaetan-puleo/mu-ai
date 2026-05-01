import { useApp } from 'ink';
import type { PluginRegistry } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { useEffect, useRef, useState } from 'react';
import type { ShutdownFn } from '../../app/shutdown';
import { listSessionsAsync, type SessionInfo } from '../../sessions/index';
import { type AbortState, useAbort } from './useAbort';
import { type AttachmentState, type TogglesState, useAttachment, useToggles } from './useAttachment';
import { type ChatSessionState, useChatSession } from './useChatSession';
import { type ModelListState, useModelList } from './useModels';

const ABORT_TIMEOUT_MS = 2000;

export interface ChatContextValue {
  config: ProviderConfig;
  session: ChatSessionState;
  toggles: TogglesState;
  attachment: AttachmentState;
  models: ModelListState;
  abort: AbortState;
  sessions: SessionInfo[];
  registry: PluginRegistry;
}

export function useChat(
  config: ProviderConfig,
  registry: PluginRegistry,
  initialMessages?: ChatMessage[],
  shutdown?: ShutdownFn,
): ChatContextValue {
  const { exit } = useApp();
  const controllerRef = useRef<AbortController | null>(null);
  const attachment = useAttachment();
  const toggles = useToggles();
  const models = useModelList(config.baseUrl, config.model);
  const session = useChatSession({
    config,
    currentModel: models.currentModel,
    attachment,
    controllerRef,
    initialMessages,
    registry,
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
    toggles,
    attachment,
    models,
    abort,
    sessions,
    registry,
  };
}
