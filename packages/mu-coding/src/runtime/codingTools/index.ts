/**
 * mu-coding's filesystem + shell tools, packaged as a plugin. Replaces the
 * legacy `createBuiltinPlugin` that lived in mu-core. Tools declare a
 * `permission.matchKey` so agent definitions can authorise them via globs.
 */

import type { Plugin } from 'mu-core';
import { createBashTool } from './bash';
import { createEditFileTool } from './edit-file';
import { createReadFileTool } from './read-file';
import { createWriteFileTool } from './write-file';

export function createCodingToolsPlugin(): Plugin {
  let pluginCwd: string | undefined;
  const getCwd = (): string => pluginCwd ?? process.cwd();

  return {
    name: 'mu-coding-tools',
    version: '0.5.0',
    tools: [
      createReadFileTool(getCwd),
      createWriteFileTool(getCwd),
      createEditFileTool(getCwd),
      createBashTool(getCwd),
    ],
    systemPrompt: [
      'File & shell tools:',
      '- Prefer `read` over `cat`/`sed`; pass `start`/`end` for large files.',
      '- Use `edit` for surgical changes; include enough context in `from` to be unique. One `edit` call per change site.',
      '- Use `write` only for new files or full rewrites.',
      '- Use `bash` for ops without a dedicated tool (ls, rg, build, tests). Avoid using it to read or rewrite files.',
    ].join('\n'),
    activate(ctx) {
      pluginCwd = ctx.cwd;
    },
  };
}

export { createBashTool, createEditFileTool, createReadFileTool, createWriteFileTool };
