export type ToolDecision = 'allow' | 'ask' | 'deny';

export type GrantValue = ToolDecision | Record<string, ToolDecision>;

export type ToolGrants = string[] | Record<string, GrantValue>;

export type ReasoningVariant = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const REASONING_VARIANTS: readonly ReasoningVariant[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export const isReasoningVariant = (value: unknown): value is ReasoningVariant =>
  typeof value === 'string' && (REASONING_VARIANTS as readonly string[]).includes(value);

// Halogen wire mapping: `off` is only reliable via `enable_thinking:false`;
// every other level is an explicit `reasoning_effort`. `medium` is the FLOOR —
// an agent with no declared variant still gets `medium`, never the server default
// (xhigh). No request ever leaves without a reasoning field.
export const variantToChatTemplateKwargs = (
  variant?: ReasoningVariant,
): Record<string, unknown> => {
  if (variant === 'off') return { enable_thinking: false };
  return { reasoning_effort: variant ?? 'medium' };
};

export interface Agent {
  name: string;
  description: string;
  prompt: string;
  tools?: ToolGrants;
  model?: string;
  variant?: ReasoningVariant;
  color?: string;
  extends?: string;
  /** When true, a `bash: 'allow'` grant only auto-approves read-only commands;
   * anything the injected `bashGuard` rejects is downgraded to `ask`. The guard
   * predicate itself is supplied by the consumer (kept out of the harness). */
  bashReadOnly?: boolean;
}
