/**
 * mu-tools — shared filesystem + shell tools for mu hosts.
 *
 * Provides `read`, `write`, `edit`, `bash`, and `list_dir` as a `Tools` map
 * compatible with the `mu-core` runtime.
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

  const tools: Tools = {};
  for (
    const tool of [
      createReadFileTool({ getCwd }),
      createWriteFileTool({ getCwd }),
      createEditFileTool({ getCwd }),
      createBashTool({
        getCwd,
        maxOutputBytes: options.bashMaxOutputBytes,
        getAbortSignal: options.getBashAbortSignal,
      }),
      createListDirTool({ getCwd }),
    ]
  ) {
    tools[tool.name] = tool;
  }
  return tools;
}
