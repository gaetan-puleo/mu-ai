import type { ChatMessage } from 'mu-core';
import { useCallback, useRef, useState } from 'react';
import { generateSessionPath, loadSession, saveSession } from '../../sessions/index';

export interface SessionPersistenceState {
  inputHistory: string[];
  appendHistory: (text: string) => void;
  sessionPathRef: React.RefObject<string>;
  /** Persist the given transcript to the current session file. */
  saveCurrent: (messages: ChatMessage[]) => void;
  /** Reset to a brand-new session: rotates the file path. */
  resetForNew: () => void;
  /**
   * Load a transcript from disk and adopt its path. Returns the loaded
   * messages so the caller can hand them to the session.
   */
  loadFromPath: (path: string) => ChatMessage[];
  /** Replace history (used after resume / load). */
  setHistory: (history: string[]) => void;
}

function userPromptsFrom(messages: ChatMessage[]): string[] {
  return messages.filter((m) => m.role === 'user').map((m) => m.content);
}

/**
 * Side-channel persistence: history bookkeeping, on-disk save, and session
 * file path management. Does NOT own the transcript — `Session` is the
 * single source of truth in the new architecture, this hook only writes to
 * disk and tracks the current target path.
 *
 * Save errors are logged to stderr and do not surface to the chat error
 * channel — they're considered non-fatal (next save attempt may succeed).
 */
export function useSessionPersistence(initialMessages?: ChatMessage[]): SessionPersistenceState {
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

  const resetForNew = useCallback(() => {
    sessionPathRef.current = generateSessionPath();
    setInputHistory([]);
  }, []);

  const loadFromPath = useCallback((path: string): ChatMessage[] => {
    const msgs = loadSession(path);
    if (msgs.length > 0) {
      sessionPathRef.current = path;
      setInputHistory(userPromptsFrom(msgs));
    }
    return msgs;
  }, []);

  const setHistory = useCallback((history: string[]) => {
    setInputHistory(history);
  }, []);

  return { inputHistory, appendHistory, sessionPathRef, saveCurrent, resetForNew, loadFromPath, setHistory };
}
