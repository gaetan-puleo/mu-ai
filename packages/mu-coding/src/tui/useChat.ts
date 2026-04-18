import { useApp } from 'ink';
import type { PluginRegistry } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { useRef } from 'react';
import { listSessions, type SessionInfo } from '../session';
import { type AbortState, useAbort } from './useAbort';
import { type ChatSessionState, useChatSession } from './useChatSession';
import { type AttachmentState, type TogglesState, useAttachment, useToggles } from './useChatUI';
import { type ModelListState, useModelList } from './useModelList';

const ABORT_TIMEOUT_MS = 2000;

export interface ChatContextValue {
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
  const abort = useAbort(session.streaming, controllerRef, exit, ABORT_TIMEOUT_MS);

  return {
    session,
    toggles,
    attachment,
    models,
    abort,
    sessions: toggles.showSessionPicker ? listSessions() : [],
    registry,
  };
}
