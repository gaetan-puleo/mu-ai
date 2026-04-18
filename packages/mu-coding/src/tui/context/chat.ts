import { createContext, useContext } from 'react';
import type { ChatContextValue } from '../useChat';

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext requires ChatProvider');
  return ctx;
}
