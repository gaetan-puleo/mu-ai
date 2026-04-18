import type { Plugin } from '../plugin';
import { bashTool } from './bash';
import { editFileTool } from './edit-file';
import { readFileTool } from './read-file';
import { writeFileTool } from './write-file';

export function createBuiltinPlugin(): Plugin {
  return {
    name: 'mu-builtin',
    version: '0.1.0',
    tools: [readFileTool, writeFileTool, editFileTool, bashTool],
  };
}
