/**
 * mu-coding-agents — packages the default coding agents (build / plan /
 * explore / review) as a plugin. The markdown files in ../agents carry the
 * prompts + permissions; on `register()` we contribute the directory to
 * `mu-agents` so the host doesn't need any wiring code.
 *
 * Ordering note: this plugin's `register()` must run BEFORE `mu-agents`'
 * `register()` — `Mu.start` honours the order of the `plugins` array.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contributeAgentsDir } from 'mu-agents';
import type { Plugin } from 'mu-core';

export function getCodingAgentsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'agents');
}

export function createCodingAgentsPlugin(): Plugin {
  return {
    name: 'mu-coding-agents',
    register() {
      contributeAgentsDir(getCodingAgentsDir());
    },
  };
}

export default createCodingAgentsPlugin;
