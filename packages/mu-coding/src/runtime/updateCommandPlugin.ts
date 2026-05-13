import { newMessage, type Plugin } from 'mu-core';
import { runUpdate } from '../cli/update';
import { getMuCodingTUI } from '../tui/api';

/**
 * Adds a `/update` slash command that triggers a full update from inside
 * the TUI. Output is captured to a toast or a system message (since
 * `runUpdate` streams to stdout, in the TUI we just surface success/fail).
 */
export function createUpdateCommandPlugin(): Plugin {
  return {
    name: 'mu-coding-update',
    register(api) {
      api.command({
        name: 'update',
        description: 'Update mu and installed plugins',
        async execute(_args, session) {
          const tui = getMuCodingTUI();
          tui?.notify('starting update…', 'info');
          try {
            await runUpdate();
            tui?.notify('update completed', 'success');
            await session.append(
              newMessage({
                role: 'system',
                content: 'mu has been updated. Restart to load the new version.',
                meta: { visibility: 'ui', transient: true },
              }),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            tui?.notify(`update failed: ${msg}`, 'error');
          }
        },
      });
    },
  };
}
