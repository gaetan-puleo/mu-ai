export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  /** Tool name to match, or '*' to match any tool. */
  tool: string;
  /**
   * Optional glob matched against the tool's stringified args (the raw `args`
   * field of a ToolCall). Supports `*` (any chars) and `?` (single char).
   * Omit to match any args.
   */
  argsPattern?: string;
  decision: PermissionDecision;
}

export interface PermissionConfig {
  rules: PermissionRule[];
  /** Decision when no rule matches. */
  default: PermissionDecision;
}

export interface PermissionCheck {
  tool: string;
  args: string;
}

export interface PermissionResult {
  decision: PermissionDecision;
  /** The rule that drove the decision (absent when the default applied). */
  matched?: PermissionRule;
}
