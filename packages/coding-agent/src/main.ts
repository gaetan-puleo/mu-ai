import type { AgentRuntime, SubAgent } from 'mu-harness';
import type { CoreEvent } from 'mu-core';
import { ChatApp } from './ui/ChatApp';

export interface MainOptions {
  /** Initial value for the "show reasoning" toggle. Owned by the caller. */
  thinkingVisible?: boolean;
  /** Notified when the user toggles thinking visibility. Caller persists. */
  onThinkingVisibleChange?: (visible: boolean) => void;
  /** Switchable primary agents (Build, Plan, etc.). Empty when none defined. */
  primaryAgents?: SubAgent[];
  /** Returns the currently active primary (or undefined). */
  getActivePrimary?: () => SubAgent | undefined;
  /** Called by the TUI (Tab) to switch the active primary. */
  setActivePrimary?: (next: SubAgent) => void;
  /** Returns the one-shot override primary set by `@<name>` mentions. */
  getOverridePrimary?: () => SubAgent | undefined;
  /** Sets/clears the one-shot override; cleared by ChatApp when the runtime returns to idle. */
  setOverridePrimary?: (next: SubAgent | undefined) => void;
  /** Sub-agents surfaced in the @-mention dropdown. */
  subAgents?: SubAgent[];
  /**
   * Invoke a sub-agent by name in an isolated runtime. Called when the user
   * `@<sub-agent>`s a message. Returns the sub-agent's final answer (or error).
   * `onEvent` streams every `CoreEvent` from the isolated runtime.
   */
  dispatchSubAgent?: (
    name: string,
    task: string,
    onEvent?: (event: CoreEvent) => void,
  ) => Promise<{ content: string; error?: string }>;
}

export async function main(agent: AgentRuntime, options: MainOptions = {}): Promise<void> {
  // State (model, thinkingVisible, activeAgent) is owned by the caller (bin).
  // `main` is purely a UI wiring layer — it must not read or write state files
  // independently, or it will clobber the caller's writes.

  const toDisplay = (a: SubAgent) => ({ name: a.name, color: a.color, description: a.description });
  const primaryDisplays = options.primaryAgents?.map(toDisplay);
  const subAgentDisplays = options.subAgents?.map(toDisplay);

  const app = new ChatApp(agent.runtime, agent.bus, agent, (code) => process.exit(code), {
    thinkingVisible: options.thinkingVisible,
    onThinkingVisibleChange: options.onThinkingVisibleChange,
    primaryAgents: primaryDisplays,
    getActivePrimary: () => {
      const override = options.getOverridePrimary?.();
      const base = options.getActivePrimary?.();
      const eff = override ?? base;
      return eff ? toDisplay(eff) : undefined;
    },
    setActivePrimary: (next) => {
      const target = options.primaryAgents?.find((a) => a.name === next.name);
      if (target) options.setActivePrimary?.(target);
    },
    setOverridePrimary: (next) => {
      if (next === undefined) {
        options.setOverridePrimary?.(undefined);
        return;
      }
      const target = options.primaryAgents?.find((a) => a.name === next.name);
      if (target) options.setOverridePrimary?.(target);
    },
    subAgents: subAgentDisplays,
    dispatchSubAgent: options.dispatchSubAgent,
  });

  process.on('SIGINT', () => {
    void app.stop().then(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    void app.stop().then(() => process.exit(143));
  });

  await app.start();
}
