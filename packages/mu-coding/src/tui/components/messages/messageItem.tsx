import type { ChatMessage } from 'mu-provider';
import React from 'react';
import { AssistantMessage } from './assistantMessage';
import { UserMessage } from './userMessage';

export const MessageItem: React.FC<{
  msg: ChatMessage;
  toolMessages?: ChatMessage[];
}> = React.memo(function MessageItem({ msg, toolMessages }) {
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
