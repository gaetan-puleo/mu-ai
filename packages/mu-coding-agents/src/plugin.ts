/**
 * mu-coding-agents — packages the default coding agents (build / plan /
 * explore / review) as a plugin. The markdown files in ../agents carry the
 * prompts + permissions; this plugin just exposes the directory path for
 * whichever agents-registry consumer wants it.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'mu-core';

export function getCodingAgentsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'agents');
}

export function createCodingAgentsPlugin(): Plugin {
  return {
    name: 'mu-coding-agents',
    register() {
      // Agents directory is exposed via getCodingAgentsDir(); hosts wire it
      // into their agent registry directly.
    },
  };
}

export default createCodingAgentsPlugin;
