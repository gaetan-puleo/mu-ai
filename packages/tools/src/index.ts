import type { Tool } from 'mu-core';
import { createBashTool } from './bash';
import { createEditFileTool } from './edit-file';
import { createListTool } from './list';
import { createReadFileTool } from './read-file';
import { createWriteFileTool } from './write-file';

export interface MuToolsOptions {
  getCwd?: () => string;
  bashMaxOutputBytes?: number;
  getBashAbortSignal?: () => AbortSignal | undefined;
}

export function createMuTools(options: MuToolsOptions = {}): Tool[] {
  const getCwd = options.getCwd ?? ((): string => process.cwd());

  return [
    createReadFileTool({ getCwd }),
    createWriteFileTool({ getCwd }),
    createEditFileTool({ getCwd }),
    createBashTool({
      getCwd,
      maxOutputBytes: options.bashMaxOutputBytes,
      getAbortSignal: options.getBashAbortSignal,
    }),
    createListTool({ getCwd }),
  ];
}

export { createBashTool, createEditFileTool, createListTool, createReadFileTool, createWriteFileTool };
