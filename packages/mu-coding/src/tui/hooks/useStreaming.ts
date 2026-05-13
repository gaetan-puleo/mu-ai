import type { Session } from 'mu-core';
import { useEffect } from 'react';
import { useDispatch } from '../state/AppContext';

/**
 * Subscribe to session events and dispatch them into the UI store.
 * Streaming text is fed via the channel directly; this hook handles
 * the transcript-level events (append, clear).
 */
export function useStreaming(session: Session): void {
  const dispatch = useDispatch();

  useEffect(() => {
    // Hydrate with whatever's already in the session.
    dispatch({ type: 'session_loaded', sessionId: session.id, messages: [...session.messages()] });

    const off = session.on((event) => {
      if (event.type === 'message_appended') {
        dispatch({ type: 'message_appended', message: event.message });
      } else if (event.type === 'transcript_cleared') {
        dispatch({ type: 'transcript_cleared' });
      }
    });
    return off;
  }, [session, dispatch]);
}
