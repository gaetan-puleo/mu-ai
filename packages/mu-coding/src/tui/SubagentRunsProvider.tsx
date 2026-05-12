import type { SubagentRunRegistry } from 'mu-agents';
import { createContext } from 'react';

/**
 * Provides the live `SubagentRunRegistry` to descendants so the
 * `SubagentMessage` renderer can subscribe to per-run status updates.
 *
 * Moved here from mu-agents/renderers.tsx — mu-agents no longer ships
 * React/Ink-flavoured code.
 */
export const SubagentRunsRegistryContext = createContext<SubagentRunRegistry | null>(null);

export function SubagentRunsProvider({
  registry,
  children,
}: {
  registry: SubagentRunRegistry;
  children: React.ReactNode;
}) {
  return (
    <SubagentRunsRegistryContext.Provider value={registry}>
      {children}
    </SubagentRunsRegistryContext.Provider>
  );
}
