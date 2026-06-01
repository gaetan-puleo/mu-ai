export interface Agent {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
  extends?: string;
}
