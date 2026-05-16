import { describe, expect, it, mock } from 'bun:test';
import type { PluginAPI, Session } from 'mu-core';
import type { Agent } from './markdown';
import { type AgentsHandle, createAgentsPlugin } from './plugin';

function makeAgent(name: string, kind: 'primary' | 'subagent', tools: string[] = ['*']): Agent {
  return {
    name,
    description: `${name} agent`,
    prompt: `You are the ${name} agent.`,
    tools,
    kind,
  };
}

describe('createAgentsPlugin', () => {
  describe('resolveActiveForTurn via handle.getActive', () => {
    it('returns the subagent agent for sessions registered via bindAgentToSession', () => {
      const buildAgent = makeAgent('build', 'primary');
      const exploreAgent = makeAgent('explore', 'subagent');

      const plugin = createAgentsPlugin({
        agents: [buildAgent, exploreAgent],
      });
      const handle: AgentsHandle = plugin.handle;

      const parentSession = { id: 'parent-1' } as Session;
      handle.setActive(parentSession, 'build');

      // The parent session should resolve to "build"
      expect(handle.getActive(parentSession)?.name).toBe('build');

      // A session without any mapping falls back to the default agent
      const unknownSession = { id: 'unknown-1' } as Session;
      expect(handle.getActive(unknownSession)?.name).toBe('build');
    });

    it('cycles through primary agents', () => {
      const buildAgent = makeAgent('build', 'primary');
      const planAgent = makeAgent('plan', 'primary');

      const plugin = createAgentsPlugin({
        agents: [buildAgent, planAgent],
      });
      const handle: AgentsHandle = plugin.handle;

      const session = { id: 'session-1' } as Session;

      // Cycle once: build → plan
      const next = handle.cycleActive(session);
      expect(next?.name).toBe('plan');

      // Cycle again: plan → build
      const next2 = handle.cycleActive(session);
      expect(next2?.name).toBe('build');
    });

    it('lists only primary agents from listPrimary', () => {
      const buildAgent = makeAgent('build', 'primary');
      const exploreAgent = makeAgent('explore', 'subagent');
      const reviewAgent = makeAgent('review', 'subagent');

      const plugin = createAgentsPlugin({
        agents: [buildAgent, exploreAgent, reviewAgent],
      });
      const handle: AgentsHandle = plugin.handle;

      const primaries = handle.listPrimary();
      expect(primaries.length).toBe(1);
      expect(primaries[0].name).toBe('build');
    });
  });
});
