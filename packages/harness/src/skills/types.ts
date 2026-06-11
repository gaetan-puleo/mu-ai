export interface Skill {
  name: string;
  description: string;
  prompt: string;
  dir?: string;
  platforms?: string[];
  command?: string;
}
