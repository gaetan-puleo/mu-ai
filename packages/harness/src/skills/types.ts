export interface Skill {
  name: string;
  description: string;
  prompt: string;
  dir?: string;
  /** OS allow-list (Hermes/agentskills.io `platforms`): macos | linux | windows. Empty/absent = all. */
  platforms?: string[];
}
