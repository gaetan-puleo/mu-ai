import type { ChatMessage } from 'mu-provider';
import { useCallback, useRef, useState } from 'react';
import { generateSessionPath, loadSession, saveSession } from '../../sessions/index';

export interface SessionPersistenceState {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  inputHistory: string[];
  appendHistory: (text: string) => void;
  sessionPathRef: React.RefObject<string>;
  saveCurrent: (messages: ChatMessage[]) => void;
  onNew: () => void;
  onLoadSession: (path: string) => void;
}

function userPromptsFrom(messages: ChatMessage[]): string[] {
  return messages.filter((m) => m.role === 'user').map((m) => m.content);
}

/**
 * Owns the conversation transcript and its on-disk persistence. Keeps the
 * current session path, the transcript, and the user-input history in sync.
 *
 * Save errors are logged to stderr and do not surface to the chat error
 * channel — they're considered non-fatal (next save attempt may succeed).
 */
export function useSessionPersistence(initialMessages?: ChatMessage[]): SessionPersistenceState {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [inputHistory, setInputHistory] = useState<string[]>(userPromptsFrom(initialMessages ?? []));
  const sessionPathRef = useRef(generateSessionPath());

  const appendHistory = useCallback((text: string) => {
    setInputHistory((prev) => [...prev, text]);
  }, []);

  const saveCurrent = useCallback((finalMessages: ChatMessage[]) => {
    saveSession(sessionPathRef.current, finalMessages).catch((err) => {
      console.error('Failed to save session:', err);
    });
  }, []);

  const onNew = useCallback(() => {
    setMessages([]);
    sessionPathRef.current = generateSessionPath();
  }, []);

  const onLoadSession = useCallback((path: string) => {
    const msgs = loadSession(path);
    if (msgs.length > 0) {
      setMessages(msgs);
      setInputHistory(userPromptsFrom(msgs));
      sessionPathRef.current = path;
    }
  }, []);

  return { messages, setMessages, inputHistory, appendHistory, sessionPathRef, saveCurrent, onNew, onLoadSession };
}
