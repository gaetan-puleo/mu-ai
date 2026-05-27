import type { Component } from 'mu-tui';
import { AssistantMessage } from '../components/AssistantMessage';
import { CommandLine, CommandResultLine, ErrorLine, HiddenThinkingLine } from '../components/SimpleLines';
import { ReasoningBlock } from '../components/ReasoningBlock';
import { SubAgentPreview } from '../components/SubAgentPreview';
import { ToolLine } from '../components/ToolLine';
import { UserMessage } from '../components/UserMessage';
import type { Transcript } from '../Transcript';
import type { SubAgentRun, SubAgentRunStore } from '../subAgentRun';

/**
 * Build components for the main chat transcript. Mutates `previewCache` so the
 * caller can address per-run preview components afterward (live activity
 * updates rebuild the preview in place via `SubAgentPreview.update`).
 */
export function buildTranscriptComponents(opts: {
  transcript: Transcript;
  subAgentRuns: SubAgentRunStore;
  previewCache: Map<string, SubAgentPreview>;
  onOpenSubAgent: (runId: string) => void;
  onOpenThinking: (line: Extract<Transcript['lines'][number], { role: 'reasoning' }>) => void;
}): Component[] {
  const components: Component[] = [];
  for (const entry of opts.transcript.lines) {
    switch (entry.role) {
      case 'user':
        components.push(new UserMessage({ content: entry.content, label: entry.label }));
        break;
      case 'assistant':
        components.push(new AssistantMessage({ content: entry.content }));
        break;
      case 'command':
        components.push(new CommandLine(entry.content));
        break;
      case 'command_result':
        components.push(new CommandResultLine(entry.content));
        break;
      case 'output_block':
        components.push(entry.component);
        break;
      case 'reasoning':
        if (entry.closed) {
          components.push(new HiddenThinkingLine(() => opts.onOpenThinking(entry)));
        } else {
          components.push(
            new ReasoningBlock({
              content: entry.content,
              layout: { width: 'fill', height: 'auto', padding: { left: 1, right: 1 } },
            }),
          );
        }
        break;
      case 'tool':
        components.push(new ToolLine(entry.name, entry.argsPreview));
        break;
      case 'error':
        components.push(new ErrorLine(entry.content));
        break;
      case 'subagent_preview': {
        const run = opts.subAgentRuns.get(entry.runId);
        if (!run) break;
        const preview = new SubAgentPreview({
          run,
          onClick: (id) => opts.onOpenSubAgent(id),
        });
        // Cache the live preview component so per-run notifications can
        // mutate the props in place without rebuilding the whole transcript.
        opts.previewCache.set(entry.runId, preview);
        components.push(preview);
        break;
      }
    }
  }
  return components;
}

/** Build components for an in-place sub-agent detail view. */
export function buildSubAgentViewComponents(run: SubAgentRun): Component[] {
  const components: Component[] = [];
  // Header line so the user knows they're in a sub-agent context.
  const status = run.status === 'running' ? '◐ running' : run.status === 'completed' ? '✓ done' : '✗ error';
  components.push(new CommandLine(`@${run.agentName} — ${run.task}    [${status}]    Esc to return`));

  for (const entry of run.transcript) {
    switch (entry.kind) {
      case 'user':
        components.push(new UserMessage({ content: entry.content }));
        break;
      case 'assistant':
        components.push(new AssistantMessage({ content: entry.content }));
        break;
      case 'reasoning':
        components.push(
          new ReasoningBlock({
            content: entry.content,
            layout: { width: 'fill', height: 'auto', padding: { left: 1, right: 1 } },
          }),
        );
        break;
      case 'tool_call':
        components.push(
          new ToolLine(entry.tool, entry.args.length > 120 ? `${entry.args.slice(0, 119)}…` : entry.args),
        );
        break;
      case 'tool_result':
        components.push(
          new CommandResultLine(entry.content.length > 200 ? `${entry.content.slice(0, 199)}…` : entry.content),
        );
        break;
      case 'error':
        components.push(new ErrorLine(entry.message));
        break;
    }
  }
  return components;
}
