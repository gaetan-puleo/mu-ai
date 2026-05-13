import type { Dispatch } from 'react';
import type { Action } from './state/uiStore';

/**
 * The TUI's dispatch is created inside React (useReducer in AppProvider).
 * Non-React code (the InkApprovalChannel, the channel-bridge submit loop)
 * needs to drive UI updates from outside the tree. This slot is set when
 * the App mounts and cleared on unmount; consumers read it lazily.
 */
let _dispatch: Dispatch<Action> | undefined;

export function setDispatch(d: Dispatch<Action> | undefined): void {
  _dispatch = d;
}

export function getDispatch(): Dispatch<Action> | undefined {
  return _dispatch;
}

export function safeDispatch(action: Action): void {
  _dispatch?.(action);
}
