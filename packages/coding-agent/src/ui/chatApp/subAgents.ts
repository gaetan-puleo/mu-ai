import type { CoreEvent, Message } from 'mu-core';
import { formatSubAgentReplyForParent } from 'mu-harness';
import type { Transcript } from '../Transcript';
import { SubAgentRunStore } from '../subAgentRun';
import type { SubAgentPreview } from '../components/SubAgentPreview';
import type { AgentDisplay } from './picker';

export interface SubAgentHost {
  /** Append/render coordination on the host's main transcript. */
  transcript: Transcript;
  /** Render the visible transcript (main or sub-agent view, host decides). */
  renderTranscript: () => void;
  /** Mutate the status line — used at dispatch start + when feeding the result back. */
  setStatus: (status: string) => void;
  /** Toggle input visibility when entering/leaving an in-place sub-agent view. */
  setInputVisible: (visible: boolean) => void;
  /** Publish events back to the primary bus (used for the synthetic user message). */
  publish: (event: { type: 'user_message'; message: Message }) => void;
  /** Tell the renderer to repaint (e.g. live activity update). */
  requestRender: () => void;
  /** Dispatch invocation supplied by the caller wiring; may be absent. */
  dispatch?: (
    name: string,
    task: string,
    onEvent?: (event: CoreEvent) => void,
  ) => Promise<{ content: string; error?: string }>;
}

/**
 * Owns sub-agent runs + their cached preview components + the "viewing" state
 * for the in-place detail screen. ChatApp delegates dispatch and view-switch
 * concerns here; rendering itself lives in `transcript.ts`.
 */
export class SubAgentController {
  readonly runs = new SubAgentRunStore();
  /** Cached preview component per run so live updates can mutate in place. */
  readonly previews = new Map<string, SubAgentPreview>();
  /** When set, the host renders this run's detail view instead of the main transcript. */
  viewing: string | undefined;
  private viewingUnsubscribe: (() => void) | undefined;

  constructor(private readonly host: SubAgentHost) {}

  /** Dispatch a sub-agent and feed its reply back into the primary bus. */
  dispatch(agent: AgentDisplay, task: string): void {
    if (!this.host.dispatch) {
      this.host.transcript.appendError(`No dispatcher wired for @${agent.name}`);
      this.host.renderTranscript();
      return;
    }
    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.runs.start({ id: runId, agentName: agent.name, agentColor: agent.color, task });

    // Append a preview entry; renderTranscript wires the live component below.
    this.host.transcript.appendSubAgentPreview(runId);
    this.host.setStatus(`@${agent.name} running...`);
    this.host.renderTranscript();

    // Subscribe to live updates: refresh the cached preview component and
    // re-render so the activity sub-line keeps pace with the sub-agent. The
    // sub-agent in-place view subscribes independently in openDetail.
    const unsubscribe = this.runs.subscribe(runId, (run) => {
      const preview = this.previews.get(runId);
      if (preview) preview.update(run);
      this.host.requestRender();
    });

    void this.host.dispatch(
      agent.name,
      task,
      (event) => this.runs.pushEvent(runId, event),
    )
      .then((result) => {
        this.runs.complete(runId, result);
        this.feedPrimary(agent.name, task, result);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.runs.complete(runId, { content: '', error: msg });
        this.feedPrimary(agent.name, task, { content: '', error: msg });
      })
      .finally(() => {
        unsubscribe();
        this.host.requestRender();
      });
  }

  /**
   * The primary takes a turn over a synthetic user message that frames the
   * sub-agent's output. ChatApp's bus handler never appends user_messages
   * to the transcript (handleSubmit does it directly), so this stays invisible
   * until the primary's response streams in. Framing comes from mu-harness so
   * user-initiated `@<sub>` and LLM-initiated `subagent({...})` produce
   * identical context blocks.
   */
  private feedPrimary(
    agentName: string,
    task: string,
    result: { content: string; error?: string },
  ): void {
    const content = formatSubAgentReplyForParent({
      agentName,
      task,
      content: result.content,
      error: result.error,
    });
    this.host.setStatus('thinking...');
    this.host.publish({ type: 'user_message', message: { role: 'user', content } });
  }

  /** Click on a SubAgentPreview → swap the visible transcript to the sub-agent's. */
  openDetail(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.viewingUnsubscribe?.();
    this.viewing = runId;
    this.host.setInputVisible(false);
    this.viewingUnsubscribe = this.runs.subscribe(runId, () => {
      if (this.viewing === runId) this.host.renderTranscript();
    });
    this.host.renderTranscript();
  }

  /** Return to the primary agent's transcript. */
  closeDetail(): void {
    if (!this.viewing) return;
    this.viewingUnsubscribe?.();
    this.viewingUnsubscribe = undefined;
    this.viewing = undefined;
    this.host.setInputVisible(true);
    this.host.renderTranscript();
  }

  /** Called from ChatApp.stop / startNewSession to detach the run listener. */
  detachViewing(): void {
    this.viewingUnsubscribe?.();
    this.viewingUnsubscribe = undefined;
    this.viewing = undefined;
  }
}
