import type { InputInfoSegment } from 'mu-core';
import { useCallback, useMemo, useRef } from 'react';
import { useChatContext } from '../chat/ChatContext';
import { dumpContext } from './dumpContext';
import type { InputBoxViewProps } from './InputBoxView';
import { useCommandExecutor } from './useCommandExecutor';
import { type InputActions, type MentionMode, useInputHandler } from './useInputHandler';
import { type MentionPickerState, useMentionPicker } from './useMentionPicker';
import { usePluginShortcuts } from './usePluginShortcuts';

export interface InputBoxProps {
  onSubmit: (text: string) => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  isActive?: boolean;
  model?: string;
  history?: string[];
  /**
   * Extra info chips rendered in the footer (before the model). Generic
   * mechanism for upstream consumers to surface context (active agent,
   * branch, ...) without `InputBox` knowing what they are.
   */
  infoSegments?: InputInfoSegment[];
}

interface BufferDraft {
  value: string;
  cursor: number;
}

/**
 * Replace `[triggerStart, cursor)` (the `<trigger><partial>` token) with the
 * chosen completion value plus a trailing space, so the user is left in a
 * sensible position for further input. File completions drop the trigger
 * (`@`) entirely — the path stands alone in the prompt — while other
 * categories (agents) keep the `@` prefix as a visible marker.
 */
function applyMention(
  value: string,
  triggerStart: number,
  cursor: number,
  trigger: string,
  completion: string,
  category: string | undefined,
): BufferDraft {
  const before = value.slice(0, triggerStart);
  const after = value.slice(cursor);
  const keepTrigger = category !== 'files';
  const insertion = `${keepTrigger ? trigger : ''}${completion} `;
  return { value: before + insertion + after, cursor: triggerStart + insertion.length };
}

interface InputHandle {
  value: string;
  cursor: number;
  setBuffer: (value: string, cursor: number) => void;
}

/**
 * Build the mention-mode controls for the picker that the input handler
 * consumes via a ref. Returns `null` when no completions are available so
 * the handler skips the override and runs the default editing bindings.
 */
function buildMentionMode(mentions: MentionPickerState, input: InputHandle): MentionMode | null {
  if (!mentions.trigger || mentions.completions.length === 0) return null;
  return {
    active: true,
    count: mentions.completions.length,
    selectedIndex: mentions.selectedIndex,
    next: () => mentions.setSelectedIndex((mentions.selectedIndex + 1) % mentions.completions.length),
    prev: () =>
      mentions.setSelectedIndex(
        mentions.selectedIndex === 0 ? mentions.completions.length - 1 : mentions.selectedIndex - 1,
      ),
    accept: () => {
      const completion = mentions.completions[mentions.selectedIndex];
      const trig = mentions.trigger;
      if (!(completion && trig)) return;
      const draft = applyMention(
        input.value,
        mentions.triggerStart,
        input.cursor,
        trig,
        completion.value,
        completion.category,
      );
      input.setBuffer(draft.value, draft.cursor);
    },
  };
}

interface ActionDeps {
  abort: ReturnType<typeof useChatContext>['abort'];
  attachment: ReturnType<typeof useChatContext>['attachment'];
  session: ReturnType<typeof useChatContext>['session'];
  models: ReturnType<typeof useChatContext>['models'];
  toggles: ReturnType<typeof useChatContext>['toggles'];
  onShowContext: () => Promise<void>;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
}

function useInputActions(deps: ActionDeps): InputActions {
  const { abort, attachment, session, models, toggles, onShowContext, onScrollUp, onScrollDown } = deps;
  return useMemo<InputActions>(
    () => ({
      onCtrlC: abort.onCtrlC,
      onEsc: abort.onEsc,
      onPaste: attachment.onPaste,
      onNew: session.onNew,
      onCompact: () => {
        void session.onCompact();
      },
      onCycleModel: models.cycleModel,
      onTogglePicker: toggles.onTogglePicker,
      onToggleSessionPicker: toggles.onToggleSessionPicker,
      onShowContext,
      onScrollUp,
      onScrollDown,
      modelCount: models.models.length,
    }),
    [
      abort.onCtrlC,
      abort.onEsc,
      attachment.onPaste,
      session.onNew,
      session.onCompact,
      models.cycleModel,
      models.models.length,
      toggles.onTogglePicker,
      toggles.onToggleSessionPicker,
      onShowContext,
      onScrollUp,
      onScrollDown,
    ],
  );
}

const EMPTY_SEGMENTS: InputInfoSegment[] = [];

export function useInputBox({
  onSubmit,
  onScrollUp,
  onScrollDown,
  isActive = true,
  model = '',
  history = [],
  infoSegments = EMPTY_SEGMENTS,
}: InputBoxProps): InputBoxViewProps {
  const { config, session, toggles, attachment, models, abort, registry, uiService } = useChatContext();
  // Ref pattern: the mention controls depend on the input handler's
  // `value`/`cursor`, but the handler also needs to reach the controls at key
  // dispatch time. Pushing the latest snapshot into a ref every render lets
  // both directions flow without re-calling hooks.
  const mentionRef = useRef<MentionMode | null>(null);

  const onShowContext = useCallback(async () => {
    try {
      const path = await dumpContext(config, session.messages, registry);
      uiService?.notify(`Context written to ${path}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      uiService?.notify(`Failed to dump context: ${msg}`, 'error');
    }
  }, [config, session.messages, registry, uiService]);

  const actions = useInputActions({
    abort,
    attachment,
    session,
    models,
    toggles,
    onShowContext,
    onScrollUp,
    onScrollDown,
  });

  const commandContext = useMemo(
    () => ({ messages: session.messages, cwd: process.cwd(), config }),
    [session.messages, config],
  );

  // `registry.getCommands()` allocates a fresh array each call; cache by
  // registry identity so `useCommandExecutor`'s memo can hit.
  const pluginCommands = useMemo(() => registry.getCommands(), [registry]);

  const commandExecutor = useCommandExecutor({
    actions,
    context: commandContext,
    pluginCommands,
  });

  const { handlers: pluginShortcuts } = usePluginShortcuts(registry);

  const input = useInputHandler({
    isActive,
    streaming: session.streaming,
    history,
    actions,
    onSubmit,
    availableCommands: commandExecutor.commands,
    onCommand: commandExecutor.execute,
    pluginShortcuts,
    mentionRef,
  });

  const mentions = useMentionPicker(registry, input.value, input.cursor);

  // Update the ref every render so the dispatch closure sees the latest.
  mentionRef.current = buildMentionMode(mentions, input);

  return {
    value: input.value,
    cursor: input.cursor,
    commands: input.commands,
    cmdIndex: input.cmdIndex,
    isCommandMode: input.isCommandMode,
    streaming: session.streaming,
    isActive,
    model,
    infoSegments,
    attachmentName: attachment.attachment?.name ?? null,
    attachmentError: attachment.attachmentError,
    mentions:
      mentions.completions.length > 0
        ? {
            completions: mentions.completions,
            selectedIndex: mentions.selectedIndex,
            partial: mentions.partial,
          }
        : null,
  };
}
