export interface Skill {
  /** Skill identifier, used by the agent to refer to it. */
  name: string;
  /** Short summary shown in the system prompt's skill list. */
  description: string;
  /** Markdown body — the actual instructions the skill expands to. */
  content: string;
  /** Path to the source file the skill was loaded from (for diagnostics). */
  filePath: string;
}
