import { useMemo } from 'react';
import { useChatContext } from '../chat/ChatContext';
import type { InputBoxViewProps } from './InputBoxView';
import { useCommandExecutor } from './useCommandExecutor';
import { type InputActions, useInputHandler } from './useInputHandler';

export interface InputBoxProps {
  onSubmit: (text: string) => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  isActive?: boolean;
  model?: string;
  history?: string[];
}

export function useInputBox({
  onSubmit,
  onScrollUp,
  onScrollDown,
  isActive = true,
  model = '',
  history = [],
}: InputBoxProps): InputBoxViewProps {
  const { config, session, toggles, attachment, models, abort, registry } = useChatContext();

  // Stable references prevent downstream `useMemo`s (e.g. inside
  // `useCommandExecutor`) from being invalidated on every render.
  const actions: InputActions = useMemo(
    () => ({
      onCtrlC: abort.onCtrlC,
      onEsc: abort.onEsc,
      onPaste: attachment.onPaste,
      onNew: session.onNew,
      onCycleModel: models.cycleModel,
      onTogglePicker: toggles.onTogglePicker,
      onToggleSessionPicker: toggles.onToggleSessionPicker,
      onScrollUp,
      onScrollDown,
      modelCount: models.models.length,
    }),
    [
      abort.onCtrlC,
      abort.onEsc,
      attachment.onPaste,
      session.onNew,
      models.cycleModel,
      models.models.length,
      toggles.onTogglePicker,
      toggles.onToggleSessionPicker,
      onScrollUp,
      onScrollDown,
    ],
  );

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

  const input = useInputHandler({
    isActive,
    streaming: session.streaming,
    history,
    actions,
    onSubmit,
    availableCommands: commandExecutor.commands,
    onCommand: commandExecutor.execute,
  });

  return {
    ...input,
    streaming: session.streaming,
    isActive,
    model,
    attachmentName: attachment.attachment?.name ?? null,
    attachmentError: attachment.attachmentError,
  };
}
