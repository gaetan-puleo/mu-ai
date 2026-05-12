/**
 * mu-tools — shared filesystem + shell tools for mu hosts.
 *
 * Provides `read`, `write`, `edit`, `bash`, and `list_dir`. Used by both
 * mu-coding (TUI) and arya-agent (autonomous WS host).
 *
 * `restrictToCwd` (opt-in) enables containment checks for path arguments:
 *  - mu-coding does NOT enable it (TUI needs absolute paths).
 *  - arya enables it for permission-glob safety.
 */

import type { Plugin, PluginTool } from 'mu-core';
import { createBashTool } from './bash';
import { createEditFileTool } from './edit-file';
import { createListDirTool } from './list-dir';
import { createReadFileTool } from './read-file';
import { createWriteFileTool } from './write-file';

export interface MuToolsPluginOptions {
  /** Working directory accessor. Defaults to `() => ctx.cwd` resolved at activate. */
  getCwd?: () => string;
  /** Enforce that path-accepting tools stay inside the cwd. Default `false`. */
  restrictToCwd?: boolean;
  /** Subset of tools to include. Default: all five. */
  tools?: ReadonlyArray<'read' | 'write' | 'edit' | 'bash' | 'list_dir'>;
}

const DEFAULT_TOOLS = ['read', 'write', 'edit', 'bash', 'list_dir'] as const;

export function createMuToolsPlugin(options: MuToolsPluginOptions = {}): Plugin {
  let pluginCwd: string | undefined;
  const getCwd = options.getCwd ?? ((): string => pluginCwd ?? process.cwd());
  const restrictToCwd = options.restrictToCwd ?? false;
  const enabled = new Set(options.tools ?? DEFAULT_TOOLS);

  const tools: PluginTool[] = [];
  if (enabled.has('read')) tools.push(createReadFileTool({ getCwd, restrictToCwd }));
  if (enabled.has('write')) tools.push(createWriteFileTool({ getCwd, restrictToCwd }));
  if (enabled.has('edit')) tools.push(createEditFileTool({ getCwd, restrictToCwd }));
  if (enabled.has('bash')) tools.push(createBashTool({ getCwd }));
  if (enabled.has('list_dir')) tools.push(createListDirTool({ getCwd, restrictToCwd }));

  return {
    name: 'mu-tools',
    version: '0.15.0',
    tools,
    systemPrompt: [
      'File & shell tools:',
      '- Prefer `read` over `cat`/`sed`; pass `start`/`end` for large files.',
      '- Use `edit` for surgical changes; include enough context in `from` to be unique. One `edit` call per change site.',
      '- Use `write` only for new files or full rewrites.',
      '- Use `list_dir` to inspect directory contents (optionally recursive with `depth`).',
      '- Use `bash` for ops without a dedicated tool (rg, build, tests). Avoid using it to read or rewrite files.',
    ].join('\n'),
    activate(ctx) {
      pluginCwd = ctx.cwd;
    },
  };
}

export { createBashTool } from './bash';
export { createEditFileTool } from './edit-file';
export { createListDirTool } from './list-dir';
export { createReadFileTool } from './read-file';
export { sanitizePath } from './utils';
export { createWriteFileTool } from './write-file';
