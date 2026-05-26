export interface MentionResult {
  /** Optional replacement text rendered in the user message. Omit to keep the raw mention text. */
  display?: string;
  /** Side payload the host can attach to the message (e.g. file content, agent metadata). */
  payload?: unknown;
}

export interface MentionResolver {
  /** Prefix without `@`, e.g. `file`, `skill`, `agent`. */
  prefix: string;
  /** Short description for UIs (palette, autocomplete). */
  description?: string;
  /**
   * Resolve the mention target. Called once per match in parallel.
   * The optional `ctx` carries call-site state (cwd, session id, etc.).
   */
  resolve(target: string, ctx: Record<string, unknown>): Promise<MentionResult> | MentionResult;
}

export interface ResolvedMention {
  /** Raw matched text, e.g. `@file:./src/foo.ts`. */
  raw: string;
  /** Prefix without `@`. */
  prefix: string;
  /** Target after the colon. */
  target: string;
  result: MentionResult;
}

export interface ExpandResult {
  /** Text after applying every resolver's `display` replacement (when set). */
  text: string;
  /** All resolved mentions in matched order. */
  mentions: ResolvedMention[];
}
