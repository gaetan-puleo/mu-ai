import type { Plugin } from '../plugin';
import { createBashTool } from './bash';
import { createEditFileTool } from './edit-file';
import { createReadFileTool } from './read-file';
import { createWriteFileTool } from './write-file';

export function createBuiltinPlugin(): Plugin {
  // Captured at activation so the file/shell tools operate on the agent's
  // declared cwd (`PluginContext.cwd`) rather than the host process's
  // `process.cwd()`. Falls back to `process.cwd()` until the plugin is
  // registered, which keeps direct standalone usage working in tests.
  let pluginCwd: string | undefined;
  const getCwd = (): string => pluginCwd ?? process.cwd();

  return {
    name: 'mu-builtin',
    version: '0.1.0',
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
