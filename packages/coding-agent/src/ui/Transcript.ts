import { type BaseChatLine, TranscriptModel } from 'mu-harness';
import { formatToolCallArgs } from './components/ToolLine';
import type { OutputBlock } from './components/OutputBlock';

/**
 * coding-agent's chat lines = harness base + two agent-specific variants:
 *  - `command` / `command_result` — slash-command echo (e.g. /help output)
 *  - `output_block` — collapsible bash-output toggle (live component handle)
 *  - `subagent_preview` — sub-agent run card identified by runId
 */
export type CodingAgentChatLine =
  | { role: 'command'; content: string }
  | { role: 'command_result'; content: string }
  | { role: 'output_block'; component: OutputBlock }
  | { role: 'subagent_preview'; runId: string };

export type ChatLine = BaseChatLine | CodingAgentChatLine;

export type UserChatLine = Extract<ChatLine, { role: 'user' }>;

/**
 * coding-agent transcript. Extends the harness `TranscriptModel` with the
 * agent-specific lines and the small helpers ChatApp needs (`appendSubAgentPreview`
 * etc.).
 */
export class Transcript extends TranscriptModel<CodingAgentChatLine> {
  constructor(thinkingVisible = true) {
    super({ thinkingVisible, formatToolCallArgs });
  }

  appendSubAgentPreview(runId: string): void {
    this.lines.push({ role: 'subagent_preview', runId });
  }
}
