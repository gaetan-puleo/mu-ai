/**
 * mu-tools — shared filesystem + shell tools for mu hosts.
 *
 * Provides `read`, `write`, `edit`, `bash`, and `list_dir` as a `Tools` map
 * compatible with the `mu-core` runtime.
 *
 * `restrictToCwd` (opt-in) enables containment checks for path arguments.
 */

import type { Tool, Tools } from 'mu-core';
import { createBashTool } from './bash';
import { createEditFileTool } from './edit-file';
import { createListDirTool } from './list-dir';
import { createReadFileTool } from './read-file';
import { createWriteFileTool } from './write-file';

export type MuToolName = 'read' | 'write' | 'edit' | 'bash' | 'list_dir';

export interface MuToolsOptions {
  /** Working directory accessor. Defaults to `process.cwd()`. */
  getCwd?: () => string;
  /** Enforce that path-accepting tools stay inside the cwd. Default `false`. */
  restrictToCwd?: boolean;
  /** Subset of tools to include. Default: all five. */
  tools?: readonly MuToolName[];
}

const DEFAULT_TOOLS: readonly MuToolName[] = ['read', 'write', 'edit', 'bash', 'list_dir'];

/**
 * Build a `Tools` map ready to pass to `createRuntime({ tools })`.
 */
export function createMuTools(options: MuToolsOptions = {}): Tools {
  const getCwd = options.getCwd ?? ((): string => process.cwd());
  const restrictToCwd = options.restrictToCwd ?? false;
  const enabled = new Set(options.tools ?? DEFAULT_TOOLS);

  const tools: Tool[] = [];
  if (enabled.has('read')) tools.push(createReadFileTool({ getCwd, restrictToCwd }));
  if (enabled.has('write')) tools.push(createWriteFileTool({ getCwd, restrictToCwd }));
  if (enabled.has('edit')) tools.push(createEditFileTool({ getCwd, restrictToCwd }));
  if (enabled.has('bash')) tools.push(createBashTool({ getCwd }));
  if (enabled.has('list_dir')) tools.push(createListDirTool({ getCwd, restrictToCwd }));

  const map: Tools = {};
  for (const t of tools) map[t.name] = t;
  return map;
}

export { createBashTool } from './bash';
export { createEditFileTool } from './edit-file';
export { createListDirTool } from './list-dir';
export { createReadFileTool } from './read-file';
export { formatError, parseArgs, sanitizePath } from './utils';
export { createWriteFileTool } from './write-file';
