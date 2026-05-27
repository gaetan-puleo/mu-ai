import type { CoreEvent, ToolCall } from 'mu-core';

export type SubAgentRunStatus = 'running' | 'completed' | 'error';

export type SubAgentTranscriptEntry =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; tool: string; args: string }
  | { kind: 'tool_result'; content: string }
  | { kind: 'error'; message: string };

export interface SubAgentRun {
  id: string;
  agentName: string;
  agentColor?: string;
  task: string;
  status: SubAgentRunStatus;
  /** One-line summary of what the sub-agent is currently doing. */
  activity: string;
  /** Final answer when the run completes; error message when it fails. */
  result?: string;
  errorMessage?: string;
  startedAt: number;
  endedAt?: number;
  /** Full event-derived transcript for the detail screen. */
  transcript: SubAgentTranscriptEntry[];
}

export interface SubAgentRunListener {
  (run: SubAgentRun): void;
}

/**
 * Tiny mutable store: tracks every dispatched sub-agent run and lets the UI
 * subscribe per-run. Designed to mirror what the host transcript already
 * does — append-only events with a current-state snapshot.
 */
export class SubAgentRunStore {
  private runs = new Map<string, SubAgentRun>();
  private perRunListeners = new Map<string, Set<SubAgentRunListener>>();

  start(opts: { id: string; agentName: string; agentColor?: string; task: string }): SubAgentRun {
    const run: SubAgentRun = {
      id: opts.id,
      agentName: opts.agentName,
      agentColor: opts.agentColor,
      task: opts.task,
      status: 'running',
      activity: 'starting…',
      transcript: [{ kind: 'user', content: opts.task }],
      startedAt: Date.now(),
    };
    this.runs.set(opts.id, run);
    this.notify(opts.id);
    return run;
  }

  get(id: string): SubAgentRun | undefined {
    return this.runs.get(id);
  }

  list(): SubAgentRun[] {
    return [...this.runs.values()];
  }

  /** Apply a runtime event to the run, updating activity + transcript. */
  pushEvent(id: string, event: CoreEvent): void {
    const run = this.runs.get(id);
    if (!run) return;
    switch (event.type) {
      case 'tool_call':
        run.transcript.push({ kind: 'tool_call', tool: event.call.name, args: event.call.args });
        run.activity = formatActivityFromToolCall(event.call);
        break;
      case 'tool_result':
        run.transcript.push({ kind: 'tool_result', content: event.message.content });
        run.activity = 'tool finished';
        break;
      case 'assistant_message':
        run.transcript.push({ kind: 'assistant', content: event.message.content });
        run.activity = previewLine(event.message.content);
        break;
      case 'reasoning_message':
        run.transcript.push({ kind: 'reasoning', content: event.message.content });
        run.activity = 'thinking…';
        break;
      case 'user_message':
        // already pushed at start; ignore re-publish from the runtime
        break;
      case 'error': {
        const msg = event.error instanceof Error ? event.error.message : String(event.error);
        run.transcript.push({ kind: 'error', message: msg });
        run.activity = `error: ${msg}`;
        break;
      }
    }
    this.notify(id);
  }

  complete(id: string, result: { content: string; error?: string }): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.endedAt = Date.now();
    if (result.error) {
      run.status = 'error';
      run.errorMessage = result.error;
      run.activity = `error: ${result.error}`;
    } else {
      run.status = 'completed';
      run.result = result.content;
      run.activity = previewLine(result.content) || 'done';
    }
    this.notify(id);
  }

  subscribe(id: string, listener: SubAgentRunListener): () => void {
    let set = this.perRunListeners.get(id);
    if (!set) {
      set = new Set();
      this.perRunListeners.set(id, set);
    }
    set.add(listener);
    return () => {
      const s = this.perRunListeners.get(id);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this.perRunListeners.delete(id);
    };
  }

  private notify(id: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    const listeners = this.perRunListeners.get(id);
    if (!listeners) return;
    for (const fn of listeners) {
      try {
        fn(run);
      } catch {
        /* listener errors must not propagate */
      }
    }
  }
}

function previewLine(text: string): string {
  const first = text.replace(/\s+/g, ' ').trim();
  if (first.length <= 80) return first;
  return `${first.slice(0, 79)}…`;
}

function formatActivityFromToolCall(call: ToolCall): string {
  const args = call.args.length > 60 ? `${call.args.slice(0, 60)}…` : call.args;
  return `${call.name}(${args})`;
}
