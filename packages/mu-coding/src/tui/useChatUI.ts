import type { ImageAttachment } from 'mu-provider';
import { useCallback, useState } from 'react';
import { readClipboardImage } from '../clipboard';

export interface AttachmentState {
  attachment: ImageAttachment | null;
  attachmentError: string | null;
  onPaste: () => void;
  clear: () => void;
}

export function useAttachment(): AttachmentState {
  const [attachment, setAttachment] = useState<ImageAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const onPaste = useCallback(() => {
    const img = readClipboardImage();
    if (img) {
      setAttachment(img);
      setAttachmentError(null);
      return;
    }
    setAttachmentError('No image on clipboard');
    setTimeout(() => setAttachmentError(null), 3000);
  }, []);

  const clear = useCallback(() => {
    setAttachment(null);
    setAttachmentError(null);
  }, []);

  return { attachment, attachmentError, onPaste, clear };
}

export interface TogglesState {
  showModelPicker: boolean;
  showSessionPicker: boolean;
  onTogglePicker: () => void;
  onToggleSessionPicker: () => void;
}

export function useToggles(): TogglesState {
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  return {
    showModelPicker,
    showSessionPicker,
    onTogglePicker: useCallback(() => setShowModelPicker((p) => !p), []),
    onToggleSessionPicker: useCallback(() => setShowSessionPicker((p) => !p), []),
  };
}
