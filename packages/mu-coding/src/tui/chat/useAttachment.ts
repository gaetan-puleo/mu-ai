import type { ImageAttachment } from 'mu-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readClipboardImage } from '../../utils/clipboard';

const ERROR_TIMEOUT_MS = 3000;

export interface AttachmentState {
  attachment: ImageAttachment | null;
  attachmentError: string | null;
  onPaste: () => void;
  clear: () => void;
}

export function useAttachment(): AttachmentState {
  const [attachment, setAttachment] = useState<ImageAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelErrorTimer = useCallback(() => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  // Cancel any pending error-clear timer if the component unmounts.
  useEffect(() => cancelErrorTimer, [cancelErrorTimer]);

  const onPaste = useCallback(() => {
    cancelErrorTimer();
    const img = readClipboardImage();
    if (img) {
      setAttachment(img);
      setAttachmentError(null);
      return;
    }
    setAttachmentError('No image on clipboard');
    errorTimerRef.current = setTimeout(() => {
      setAttachmentError(null);
      errorTimerRef.current = null;
    }, ERROR_TIMEOUT_MS);
  }, [cancelErrorTimer]);

  const clear = useCallback(() => {
    cancelErrorTimer();
    setAttachment(null);
    setAttachmentError(null);
  }, [cancelErrorTimer]);

  return { attachment, attachmentError, onPaste, clear };
}

type PickerKind = 'model' | 'sessions' | null;

export interface TogglesState {
  showModelPicker: boolean;
  showSessionPicker: boolean;
  onTogglePicker: () => void;
  onToggleSessionPicker: () => void;
}

/**
 * At most one picker is visible at a time. Toggling on a picker while the
 * other is open swaps to the new one rather than stacking modals.
 */
export function useToggles(): TogglesState {
  const [picker, setPicker] = useState<PickerKind>(null);
  return {
    showModelPicker: picker === 'model',
    showSessionPicker: picker === 'sessions',
    onTogglePicker: useCallback(() => setPicker((p) => (p === 'model' ? null : 'model')), []),
    onToggleSessionPicker: useCallback(() => setPicker((p) => (p === 'sessions' ? null : 'sessions')), []),
  };
}
