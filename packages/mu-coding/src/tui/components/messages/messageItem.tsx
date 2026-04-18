import type { ChatMessage } from 'mu-provider';
import React from 'react';
import { AssistantMessage } from './assistantMessage';
import { UserMessage } from './userMessage';

export const MessageItem: React.FC<{
  msg: ChatMessage;
  messages: ChatMessage[];
  index: number;
}> = React.memo(function MessageItem({ msg, messages, index }) {
  // Tool result messages are rendered inline within ToolCallBlock
  if (msg.role === 'tool') {
    return null;
  }

  // Check if this assistant message has tool calls
  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    // Collect following tool messages
    const toolMessages: ChatMessage[] = [];
    for (let i = index + 1; i < messages.length; i++) {
      if (messages[i].role === 'tool') {
        toolMessages.push(messages[i]);
      } else {
        break;
      }
    }

    return <AssistantMessage msg={msg} toolMessages={toolMessages} />;
  }

  if (msg.role === 'user') {
    return <UserMessage msg={msg} />;
  }

  return <AssistantMessage msg={msg} />;
});
