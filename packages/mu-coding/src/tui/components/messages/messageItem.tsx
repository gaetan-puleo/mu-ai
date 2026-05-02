import type { ChatMessage } from 'mu-provider';
import React from 'react';
import { useMessageRenderer } from '../../chat/MessageRendererContext';
import { AssistantMessage } from './assistantMessage';
import { UserMessage } from './userMessage';

export const MessageItem: React.FC<{
  msg: ChatMessage;
  toolMessages?: ChatMessage[];
}> = React.memo(function MessageItem({ msg, toolMessages }) {
  const customRenderer = useMessageRenderer(msg.customType);

  // Plugins may flag a message as `hidden` to keep it in the LLM transcript
  // while suppressing on-screen rendering (e.g. system reminders carried with
  // the user's next turn).
  if (msg.display?.hidden) {
    return null;
  }

  // Custom-typed messages always defer to a registered renderer when one is
  // available; otherwise fall through to the role-default rendering so a
  // plugin can ship messages whose renderer isn't loaded yet without losing
  // their content.
  if (customRenderer) {
    return <>{customRenderer(msg)}</>;
  }

  // Tool result messages are rendered inline within ToolCallBlock via the
  // pre-built index passed from MessageView; suppress them at the top level.
  if (msg.role === 'tool') {
    return null;
  }

  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    return <AssistantMessage msg={msg} toolMessages={toolMessages} />;
  }

  if (msg.role === 'user') {
    return <UserMessage msg={msg} />;
  }

  return <AssistantMessage msg={msg} />;
});
