import {
  type BeforeToolHook,
  type CoreEvent,
  createBus,
  createInMemorySessionStore,
  createRuntime,
  type Plugin,
  type SessionStore,
  type ToolHooks,
  type Tools,
} from 'mu-core';
import { createPermissionHook, type PermissionPrompt } from '../permissions/hook';
import { createPermissionRegistry } from '../permissions/registry';
import type { SubAgent } from './types';

export interface RunSubAgentOptions {
  subAgent: SubAgent;
  /** Task description sent as the sub-agent's user message. */
  prompt: string;
  /** Full tool pool; filtered down to subAgent.tools before the runtime sees them. */
  tools?: Tools;
  /** Plugins inherited from the parent (provider, lifecycle hooks). Tools are filtered. */
  plugins?: Plugin[];
  /** Extra hooks composed on top of the sub-agent's permission hook. */
  hooks?: ToolHooks;
  /**
   * Approval prompt used when the sub-agent's permission rules say `ask`.
   * Absent → unresolved `ask` calls are denied (see `createPermissionHook`).
   */
  approvalPrompt?: PermissionPrompt;
  /**
   * Default decision when no rule in `subAgent.permissions` matches. Defaults
   * to `'allow'` (sub-agents trust their parent unless they constrain
   * themselves). Hosts can pass `'ask'` for a more cautious posture.
   */
  permissionDefault?: 'allow' | 'deny' | 'ask';
  /**
   * Optional system prompt prefix prepended to the sub-agent's body. Useful
   * for environmental context (cwd, allowed paths) shared with the parent.
   */
  systemPromptPrefix?: string;
  /** Poll interval (ms) used to detect runtime idle. Defaults to 10ms. */
  pollIntervalMs?: number;
  /**
   * Optional cancellation channel. When aborted, the runner stops polling for
   * idle, tears the runtime down, and surfaces the abort reason in `errors`.
   */
  signal?: AbortSignal;
  /**
   * Hard ceiling on how long `waitForIdle` will poll before giving up. Defaults
   * to 10 minutes — long enough for any realistic single sub-agent task, short
   * enough that a wedged runtime doesn't leak forever. Pass `Infinity` to
   * disable.
   */
  timeoutMs?: number;
  /**
   * Forwards every `CoreEvent` the sub-agent's runtime emits. Useful when the
   * host wants to display the sub-agent's transcript live (separate from the
   * parent runtime).
   */
  onEvent?: (event: CoreEvent) => void;
  /**
   * Where to register the sub-agent's transient session. Defaults to a fresh
   * in-memory store scoped to this run (sessions are not retained). Pass a
   * shared store if you want sub-agent runs to appear in the parent's session list.
   */
  store?: SessionStore;
}

export interface SubAgentRunResult {
  agentName: string;
  content: string;
  /** First error (if any) — kept for backward compatibility with single-error consumers. */
  error?: string;
  /** Every error emitted during the sub-agent run, in order. */
  errors?: string[];
}

/**
 * Spawn an isolated runtime for `subAgent`, send it `prompt`, collect the
 * final assistant content, and tear down. The sub-agent only sees tools
 * present in its allow list, and its own permission rules are enforced
 * before each tool call.
 */
export async function runSubAgent(opts: RunSubAgentOptions): Promise<SubAgentRunResult> {
  const { subAgent, prompt } = opts;
  const allow = subAgent.tools;
  const tools = filterTools(opts.tools ?? {}, allow);
  const plugins = (opts.plugins ?? []).map((p) => filterPlugin(p, allow));

  const systemPrompt = opts.systemPromptPrefix
    ? `${opts.systemPromptPrefix}\n\n${subAgent.prompt}`
    : subAgent.prompt;

  const hooks = composeHooks(subAgent, opts);

  const bus = createBus<CoreEvent>();
  const store = opts.store ?? createInMemorySessionStore();
  const session = store.create({ title: `sub-agent:${subAgent.name}` });
  const runtime = createRuntime({
    bus,
    tools,
    plugins,
    hooks,
    systemPrompt,
    session,
  });

  let lastContent = '';
  const runErrors: unknown[] = [];
  const onEvent = opts.onEvent;
  const unsubscribe = bus.subscribe((event) => {
    if (onEvent) {
      try {
        onEvent(event);
      } catch {
        /* listener errors must not break the sub-agent run */
      }
    }
    if (event.type === 'assistant_message') {
      lastContent = event.message.content;
    } else if (event.type === 'error') {
      runErrors.push(event.error);
    }
  });

  try {
    await runtime.start();
    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: prompt },
    });

    await waitForIdle(runtime, {
      pollMs: opts.pollIntervalMs ?? 10,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? 10 * 60 * 1000,
    });
  } catch (err) {
    runErrors.push(err);
  } finally {
    unsubscribe();
    await runtime.stop();
  }

  if (runErrors.length > 0) {
    const messages = runErrors.map((e) => (e instanceof Error ? e.message : String(e)));
    return { agentName: subAgent.name, content: lastContent, error: messages[0], errors: messages };
  }
  return { agentName: subAgent.name, content: lastContent };
}

function composeHooks(subAgent: SubAgent, opts: RunSubAgentOptions): ToolHooks | undefined {
  // Tag every approval request emitted from this sub-agent with its name so
  // the host UI can disambiguate concurrent prompts from parallel sub-agents.
  const taggedPrompt: PermissionPrompt | undefined = opts.approvalPrompt
    ? (call, matched, meta) =>
      opts.approvalPrompt!(call, matched, { ...meta, agent: meta?.agent ?? subAgent.name })
    : undefined;

  const permissionHook = subAgent.permissions.length > 0
    ? createPermissionHook({
      registry: createPermissionRegistry({
        rules: subAgent.permissions,
        default: opts.permissionDefault ?? 'allow',
      }),
      prompt: taggedPrompt,
    })
    : undefined;

  if (!permissionHook) return opts.hooks;
  if (!opts.hooks?.beforeTool) {
    return { ...opts.hooks, beforeTool: permissionHook };
  }
  const userBefore = opts.hooks.beforeTool;
  const combined: BeforeToolHook = async (data) => {
    const blocked = await permissionHook(data);
    if (blocked) return blocked;
    return userBefore(data);
  };
  return { ...opts.hooks, beforeTool: combined };
}

function filterTools(tools: Tools, allow: string[]): Tools {
  if (allow.includes('*')) return tools;
  const allowed = new Set(allow);
  const out: Tools = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (allowed.has(name)) out[name] = tool;
  }
  return out;
}

function filterPlugin(plugin: Plugin, allow: string[]): Plugin {
  if (allow.includes('*') || !plugin.tools) return plugin;
  return { ...plugin, tools: filterTools(plugin.tools, allow) };
}

interface WaitForIdleOptions {
  pollMs: number;
  signal?: AbortSignal;
  timeoutMs: number;
}

async function waitForIdle(
  runtime: ReturnType<typeof createRuntime>,
  opts: WaitForIdleOptions,
): Promise<void> {
  // Yield a microtask so processQueue starts before we check state.
  await Promise.resolve();
  const { pollMs, signal, timeoutMs } = opts;
  if (signal?.aborted) throw abortError(signal);
  const deadline = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : Infinity;
  while (runtime.state() !== 'idle') {
    if (signal?.aborted) throw abortError(signal);
    if (Date.now() >= deadline) {
      throw new Error(`sub-agent waitForIdle timed out after ${timeoutMs}ms`);
    }
    await sleep(pollMs, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError(signal!));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(abortError(signal));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === 'string' ? reason : 'sub-agent run aborted');
}
