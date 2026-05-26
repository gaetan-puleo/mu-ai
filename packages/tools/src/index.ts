/**
 * mu-tools — shared filesystem + shell tools for mu hosts.
 *
 * Provides `read`, `write`, `edit`, `bash`, and `list_dir` as a `Tools` map
 * compatible with the `mu-core` runtime.
 *
 * `restrictToCwd` (opt-in) enables containment checks for path arguments.
 */

import type { Tools } from 'mu-core';
import { createBashTool } from './bash';
import { createEditFileTool } from './edit-file';
import { createListDirTool } from './list-dir';
import { createReadFileTool } from './read-file';
import { createWriteFileTool } from './write-file';

export interface MuToolsOptions {
  /** Working directory accessor. Defaults to `process.cwd()`. */
  getCwd?: () => string;
  /** Enforce that path-accepting tools stay inside the cwd. Default `false`. */
  restrictToCwd?: boolean;
}

/**
 * Build a `Tools` map ready to pass to `createRuntime({ tools })`.
 */
export function createMuTools(options: MuToolsOptions = {}): Tools {
  const getCwd = options.getCwd ?? ((): string => process.cwd());
  const restrictToCwd = options.restrictToCwd ?? false;

  const tools: Tools = {};
  for (
    const tool of [
      createReadFileTool({ getCwd, restrictToCwd }),
      createWriteFileTool({ getCwd, restrictToCwd }),
      createEditFileTool({ getCwd, restrictToCwd }),
      createBashTool({ getCwd }),
      createListDirTool({ getCwd, restrictToCwd }),
    ]
  ) {
    tools[tool.name] = tool;
  }
  return tools;
}
