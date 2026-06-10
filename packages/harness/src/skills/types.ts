export interface Skill {
  name: string;
  description: string;
  prompt: string;
  dir?: string;
  /** OS allow-list (Hermes/agentskills.io `platforms`): macos | linux | windows. Empty/absent = all. */
  platforms?: string[];
  /**
   * Opt-in slash command name. When set, the harness registers a command that
   * runs this skill (args become its task). Absent = no command for this skill.
   */
  command?: string;
}
