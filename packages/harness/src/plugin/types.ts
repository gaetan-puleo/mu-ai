import type { Tool } from 'mu-core';
import type { Agent } from '../agents';
import type { AgentSessionHooks } from '../hooks';
import type { Skill } from '../skills';

export interface Plugin {
  name: string;
  tools?: Tool[];
  hooks?: AgentSessionHooks;
  agents?: Agent[];
  skills?: Skill[];
}
