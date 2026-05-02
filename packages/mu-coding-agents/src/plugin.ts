/**
 * mu-coding-agents — packages the default coding agents (build / plan /
 * explore / review) as a plugin. The plugin only registers the directory
 * with `ctx.agents` (the AgentSourceRegistry exposed by mu-agents); the
 * markdown files themselves carry the prompts + permissions.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'mu-core';

export function createCodingAgentsPlugin(): Plugin {
  const here = dirname(fileURLToPath(import.meta.url));
  const agentsDir = join(here, '..', 'agents');
  return {
    name: 'mu-coding-agents',
    version: '0.5.0',
    activate(ctx) {
      ctx.agents?.registerSource(agentsDir);
    },
  };
}

// Default export so hosts can `import codingAgents from 'mu-coding-agents'`.
export default createCodingAgentsPlugin;
