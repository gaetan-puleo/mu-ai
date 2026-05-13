import type { Message } from 'mu-core';
import type { ApprovalDecision, ApprovalRequest } from 'mu-agents';

export interface Toast {
  id: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

export interface StatusSegment {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

export interface SubRunSummary {
  runId: string;
  agentName: string;
  task: string;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  endedAt?: number;
  events: string[]; // formatted event lines for the timeline
}

export type ModalKind =
  | { kind: 'approval'; req: ApprovalRequest; resolve: (d: ApprovalDecision) => void }
  | { kind: 'sessionList' }
  | { kind: 'modelPicker'; models: string[]; current?: string }
  | { kind: 'commandPicker'; partial: string }
  | { kind: 'mentionPicker'; partial: string }
  | {
      kind: 'confirm';
      title: string;
      message?: string;
      resolve: (value: boolean) => void;
    }
  | {
      kind: 'select';
      title: string;
      options: string[];
      placeholder?: string;
      resolve: (value: string | null) => void;
    }
  | {
      kind: 'input';
      title: string;
      placeholder?: string;
      resolve: (value: string | null) => void;
    };

export type Panel = 'none' | 'subagent';

export interface UiState {
  sessionId: string;
  /** Final messages from the session transcript. */
  messages: Message[];
  /** Live streaming state for the in-flight assistant message, if any. */
  streaming?: { content: string; reasoning: string };
  modal?: ModalKind;
  panel: Panel;
  /** Plugin-registered status segments keyed by stable id. */
  status: Map<string, StatusSegment[]>;
  toasts: Toast[];
  activeAgent?: string;
  /** Active model id. Undefined until the user picks one (or one is provided via config / --model). */
  model?: string;
  tokens?: { prompt: number; completion: number; total: number };
  subRuns: Map<string, SubRunSummary>;
}

export type Action =
  | { type: 'session_loaded'; sessionId: string; messages: Message[] }
  | { type: 'message_appended'; message: Message }
  | { type: 'transcript_cleared' }
  | { type: 'stream_chunk'; content?: string; reasoning?: string }
  | { type: 'stream_end' }
  | { type: 'modal_open'; modal: ModalKind }
  | { type: 'modal_close' }
  | { type: 'panel_toggle'; panel: Panel }
  | { type: 'toast_push'; toast: Toast }
  | { type: 'toast_dismiss'; id: string }
  | { type: 'status_set'; key: string; segments: StatusSegment[] }
  | { type: 'status_clear'; key: string }
  | { type: 'set_active_agent'; name: string | undefined }
  | { type: 'set_model'; model: string }
  | { type: 'set_tokens'; prompt: number; completion: number; total: number }
  | { type: 'subrun_upsert'; run: SubRunSummary }
  | { type: 'subrun_append_event'; runId: string; line: string };

export function initialUiState(sessionId: string, model: string | undefined): UiState {
  return {
    sessionId,
    messages: [],
    panel: 'none',
    status: new Map(),
    toasts: [],
    model,
    subRuns: new Map(),
  };
}

export function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'session_loaded':
      return { ...state, sessionId: action.sessionId, messages: action.messages, streaming: undefined };

    case 'message_appended':
      return { ...state, messages: [...state.messages, action.message], streaming: undefined };

    case 'transcript_cleared':
      return { ...state, messages: [], streaming: undefined };

    case 'stream_chunk': {
      const cur = state.streaming ?? { content: '', reasoning: '' };
      return {
        ...state,
        streaming: {
          content: action.content !== undefined ? action.content : cur.content,
          reasoning: action.reasoning !== undefined ? action.reasoning : cur.reasoning,
        },
      };
    }

    case 'stream_end':
      return { ...state, streaming: undefined };

    case 'modal_open':
      return { ...state, modal: action.modal };

    case 'modal_close':
      return { ...state, modal: undefined };

    case 'panel_toggle':
      return { ...state, panel: state.panel === action.panel ? 'none' : action.panel };

    case 'toast_push':
      return { ...state, toasts: [...state.toasts, action.toast] };

    case 'toast_dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };

    case 'status_set': {
      const next = new Map(state.status);
      next.set(action.key, action.segments);
      return { ...state, status: next };
    }

    case 'status_clear': {
      const next = new Map(state.status);
      next.delete(action.key);
      return { ...state, status: next };
    }

    case 'set_active_agent':
      return { ...state, activeAgent: action.name };

    case 'set_model':
      return { ...state, model: action.model };

    case 'set_tokens':
      return {
        ...state,
        tokens: { prompt: action.prompt, completion: action.completion, total: action.total },
      };

    case 'subrun_upsert': {
      const next = new Map(state.subRuns);
      next.set(action.run.runId, action.run);
      return { ...state, subRuns: next };
    }

    case 'subrun_append_event': {
      const next = new Map(state.subRuns);
      const existing = next.get(action.runId);
      if (existing) {
        next.set(action.runId, { ...existing, events: [...existing.events, action.line] });
      }
      return { ...state, subRuns: next };
    }

    default:
      return state;
  }
}
