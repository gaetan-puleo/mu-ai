import type { SlashCommand } from 'mu-agents';
import type { PiCommandOptions, PiExtensionCommandContext } from './types';

/**
 * Translate a Pi command registration into a mu SlashCommand.
 *
 * Key differences:
 * - Pi handler receives (args: string, ctx: ExtensionCommandContext)
 * - Mu execute receives (args: string, context: CommandContext) and returns string | undefined
 * - Pi command ctx has session control methods (stubbed in mu)
 */
export function translateCommand(
  name: string,
  options: PiCommandOptions,
  ctx: PiExtensionCommandContext,
): SlashCommand {
  return {
    name,
    description: options.description ?? '',
    async execute(args, commandCtx) {
      // Update the context's cwd to match mu's command context
      (ctx as { cwd: string }).cwd = commandCtx.cwd;

      try {
        await options.handler(args, ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return `Error: ${msg}`;
      }
      return undefined;
    },
  };
}
