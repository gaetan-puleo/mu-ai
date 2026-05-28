/**
 * A value of `T`, or a (sync/async) function that yields `T` (or `undefined`).
 * Lets hosts pass static strings or lazy callbacks interchangeably.
 */
export type Resolvable<T> = T | (() => T | undefined | Promise<T | undefined>);

/**
 * Per-invocation context handed to `Tool.execute` and `Tool.onError`. Carries
 * runtime-scoped collaborators that the tool author would otherwise have to
 * fish out of module globals — most notably the per-turn `AbortSignal`.
 */
export interface ToolContext {
  /**
   * Fires when the host runtime is asked to stop the in-flight turn. Tools
   * doing long-running I/O (subprocess spawn, `fetch`) should pass this on to
   * the OS so a Ctrl-C actually unwedges them. Optional — `execute` callers
   * that don't supply a signal still work; the tool should treat it as
   * "no cancellation requested".
   */
  signal?: AbortSignal;
}

/**
 * Typed tool definition. `TArgs` is the parsed shape `execute` receives
 * (the runtime JSON-parses the wire `ToolCall.args` before invoking us), and
 * `TResult` is what we return — defaults to `string` so existing tools keep
 * working without per-call boilerplate.
 *
 * Note: the runtime does NOT validate `TArgs` against `parameters`. The cast
 * happens at the `execute` boundary; tool authors should still defensively
 * narrow before trusting fields. A future round may add a schema validator.
 */
// deno-lint-ignore no-explicit-any -- defaults must remain assignable to `Tools = Record<string, Tool>`.
export interface Tool<TArgs = any, TResult = string> {
  name: string;
  description: Resolvable<string | undefined>;
  parameters: Record<string, unknown>;
  /**
   * Per-tool system prompt fragment. The core runtime does NOT auto-inject
   * this — it's consumed by the harness when composing the full system prompt.
   */
  systemPrompt?: Resolvable<string | undefined>;
  execute: (args: TArgs, ctx?: ToolContext) => TResult | Promise<TResult>;
  onError?: (error: unknown, ctx?: ToolContext) => TResult | Promise<TResult>;
}

/**
 * A map of tool name → `Tool`. Generic so plugin authors can express the
 * concrete names: `const tools = { read, write } satisfies Tools` keeps
 * `keyof typeof tools` as `'read' | 'write'` instead of widening to `string`.
 */
export type Tools = Record<string, Tool>;

/**
 * The wire shape: providers emit `args` as a JSON string and the runtime
 * parses it once before calling `Tool.execute`. Keeping `args: string` here
 * preserves provider compatibility (OpenAI, Anthropic, etc. all serialize
 * function arguments as JSON strings).
 */
export interface ToolCall {
  id: string;
  name: string;
  args: string;
}
