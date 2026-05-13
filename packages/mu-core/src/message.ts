/**
 * Message helper. Stamps `id` and `ts` if absent.
 */

import { newMessageId, nowMs } from './ids';
import type { Message, Role } from './types';

export interface NewMessageInit extends Partial<Omit<Message, 'role'>> {
  role: Role;
  content?: string;
}

/**
 * Build a `Message`. Auto-stamps `id` (via `newMessageId`) and `ts` when
 * not supplied. Defaults `content` to `''`.
 */
export function newMessage(init: NewMessageInit): Message {
  const role = init.role;
  const id = init.id ?? newMessageId(role, init.toolCallId);
  const ts = init.ts ?? nowMs();
  return {
    ...init,
    id,
    ts,
    role,
    content: init.content ?? '',
  };
}
