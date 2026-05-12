/**
 * Canonical "user text → run a turn" entry point.
 *
 * Every non-trivial host (arya WS, mu-coding TUI, future Telegram bot,
 * future web SPA) needs the same sequence:
 *
 *   1. Run `transformUserInput` hooks. Outcomes:
 *      - `intercept`  → plugin handled the input completely, bail.
 *      - `continue`   → plugin appended its own user msg + queued an
 *                       injectNext; we run a turn with no userMessage.
 *      - `transform`  → rewrite the user text.
 *      - `pass`       → leave as-is.
 *   2. Build the user `ChatMessage` (unless `continue`).
 *   3. Pipe through `decorateMessage` hooks (mu-agents stamps agent
 *      attribution here).
 *   4. Apply the host's optional `decorateUserMessage` callback
 *      (mu-coding uses this for image attachments).
 *   5. Drain the `messages.drainNext()` queue into the session.
 *   6. Run the turn.
 *
 * Lives in mu-core so every host shares the exact same orchestration —
 * no copy-paste between arya and mu-coding.
 */

import { runDecorateMessageHooks, runTransformUserInputHooks } from '../hooks';
import type { MessageBusRouter } from '../messageBus/sessionScoped';
import type { MessageBus } from '../plugin';
import type { PluginRegistry } from '../registry';
import type { Session } from '../session';
import type { ChatMessage, ProviderConfig } from '../types/llm';

interface RunHostTurnInput {
  /** Target Session — the turn runs against this transcript. */
  session: Session;
  /** Live plugin registry — hooks are pulled from here at call time. */
  registry: PluginRegistry;
  /**
   * Session-scoped MessageBus router. `runHostTurn` pins the bus to
   * `session.id` for the duration of the call so plugin hooks see the
   * right per-session buffer when they call `append` / `injectNext`.
   * Any queued `injectNext` messages are drained into the session
   * before `runTurn` so they splice into the upcoming transcript.
   *
   * May be omitted on hosts without synthetic-message support —
   * `continue` will still work but no relay prompts will be injected.
   */
  messageBus?: MessageBusRouter | MessageBus;
  /** Raw user text from the channel. */
  userText: string;
  /** Provider config for the turn. */
  config: ProviderConfig;
  /** Model id — overrides the session's default for this turn. */
  model?: string;
  /**
   * Optional decoration of the user message before it lands in the
   * session. mu-coding uses this to attach images; arya passes nothing.
   * Runs AFTER `runDecorateMessageHooks` so plugin decorations are
   * preserved.
   */
  decorateUserMessage?: (msg: ChatMessage) => ChatMessage | Promise<ChatMessage>;
}

/**
 * What happened during the turn. Hosts use this to decide whether to
 * also push their own "user message" event (skip on `continued`).
 */
export type RunHostTurnOutcome = { kind: 'ran' } | { kind: 'intercepted' } | { kind: 'continued' };

function isRouter(bus: MessageBus | MessageBusRouter | undefined): bus is MessageBusRouter {
  return !!bus && typeof (bus as MessageBusRouter).setCurrentSession === 'function';
}

export async function runHostTurn(input: RunHostTurnInput): Promise<RunHostTurnOutcome> {
  const sessionId = input.session.id;
  const bus = input.messageBus;
  const router = isRouter(bus) ? bus : undefined;

  // Pin the bus for the duration of the hook chain + turn so synchronous
  // `bus.append` / `bus.injectNext` calls inside hooks route to this
  // session's buffer. Always unpin in `finally`.
  router?.setCurrentSession(sessionId);
  try {
    const hooks = input.registry.getHooks();
    const transform = await runTransformUserInputHooks(hooks, input.userText);

    if (transform.kind === 'intercept') {
      return { kind: 'intercepted' };
    }

    const isContinue = transform.kind === 'continue';
    const finalText = transform.kind === 'transform' ? transform.text : input.userText;

    let userMessage: ChatMessage | undefined;
    if (!isContinue) {
      let msg: ChatMessage = { role: 'user', content: finalText };
      msg = await runDecorateMessageHooks(hooks, msg);
      if (input.decorateUserMessage) {
        msg = await input.decorateUserMessage(msg);
      }
      userMessage = msg;
    }

    // Drain queued injections for THIS session. Prefer the per-session
    // router method when available so a bus pinned to a different
    // session by accident still drains the right queue.
    if (router) {
      for (const inj of router.drainNextFor(sessionId)) {
        input.session.queueForNextTurn(inj);
      }
    } else if (bus) {
      for (const inj of bus.drainNext()) {
        input.session.queueForNextTurn(inj);
      }
    }

    await input.session.runTurn({
      userMessage,
      config: input.config,
      model: input.model,
      registry: input.registry,
    });

    return { kind: isContinue ? 'continued' : 'ran' };
  } finally {
    router?.setCurrentSession(null);
  }
}

