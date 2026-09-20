export interface Skill {
  name: string;
  description: string;
  prompt: string;
  dir?: string;
  platforms?: string[];
  command?: string;
  // Agent Skills (agentskills.io) optional frontmatter.
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
}
