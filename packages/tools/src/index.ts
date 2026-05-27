/**
 * mu-tools — shared filesystem + shell tools for mu hosts.
 *
 * Provides `read`, `write`, `edit`, `bash`, and `list_dir` as a `Tools` map
 * compatible with the `mu-core` runtime.
 *
 * `restrictToCwd` (opt-in) enables containment checks for path arguments and,
 * for `bash`, prefixes the command with `cd "$CWD" && …` so relative paths
 * stay anchored to the contained directory.
 *
 * Each tool now declares a typed `args` interface and uses `ctx.signal` from
 * the runtime for cancellation. The legacy `getBashAbortSignal` factory option
 * is preserved for hosts that haven't migrated to context-supplied signals.
 */

import type { Tools } from 'mu-core';
import { createBashTool } from './bash';
import { createEditFileTool } from './edit-file';
import { createListDirTool } from './list-dir';
import { createReadFileTool } from './read-file';
import { createWriteFileTool } from './write-file';

export interface MuToolsOptions {
  /** Working directory accessor. Defaults to `process.cwd()`. Validated lazily on first tool use. */
  getCwd?: () => string;
  /** Enforce that path-accepting tools stay inside the cwd. Default `false`. */
  restrictToCwd?: boolean;
  /** Cap on combined stdout/stderr bytes for `bash`. Default 10 MiB. */
  bashMaxOutputBytes?: number;
  /**
   * Per-call abort hook for `bash`. Now optional — the runtime's per-turn
   * `AbortSignal` arrives via `ToolContext.signal`. Retain this only when
   * threading a host-controlled signal in addition to the runtime's.
   */
  getBashAbortSignal?: () => AbortSignal | undefined;
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
      createBashTool({
        getCwd,
        restrictToCwd,
        maxOutputBytes: options.bashMaxOutputBytes,
        getAbortSignal: options.getBashAbortSignal,
      }),
      createListDirTool({ getCwd, restrictToCwd }),
    ]
  ) {
    tools[tool.name] = tool;
  }
  return tools;
}
