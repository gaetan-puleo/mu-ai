import type { Message } from 'mu-core';
import { AssistantMessage } from './assistantMessage';
import { SystemMessage } from './systemMessage';
import { ToolMessage } from './toolMessage';
import { UserMessage } from './userMessage';

export function MessageItem({ message, transcript }: { message: Message; transcript: Message[] }) {
  if (message.meta?.visibility === 'llm') return null;

  switch (message.role) {
    case 'user':
      return <UserMessage message={message} />;
    case 'assistant':
      return <AssistantMessage message={message} />;
    case 'system':
      return <SystemMessage message={message} />;
    case 'tool':
      return <ToolMessage message={message} transcript={transcript} />;
    default:
      return null;
  }
}
