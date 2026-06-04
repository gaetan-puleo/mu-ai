import type { Agent, ToolDecision, ToolGrants } from './types';

export interface AgentRegistry {
  list(): Agent[];
  get(name: string): Agent | undefined;
}

const asMap = (tools: ToolGrants | undefined): Record<string, ToolDecision> | undefined => {
  if (!tools) return undefined;
  if (Array.isArray(tools)) return Object.fromEntries(tools.map((tool) => [tool, 'allow' as ToolDecision]));
  return tools;
};

export const toolDecision = (agent: Agent, tool: string): ToolDecision => {
  const map = asMap(agent.tools);
  if (!map) return 'allow';
  return map[tool] ?? map['*'] ?? 'deny';
};

export const toolNames = (agent: Agent): string[] | undefined => {
  const map = asMap(agent.tools);
  if (!map) return undefined;
  if (map['*'] && map['*'] !== 'deny') return ['*'];
  return Object.entries(map).filter(([, decision]) => decision !== 'deny').map(([tool]) => tool);
};

const merge = (base: Agent, child: Agent): Agent => ({
  name: child.name,
  description: child.description || base.description,
  prompt: child.prompt || base.prompt,
  tools: child.tools ?? base.tools,
  model: child.model ?? base.model,
  color: child.color ?? base.color,
});

export const createAgentRegistry = (agents: Agent[] = []): AgentRegistry => {
  const raw = new Map<string, Agent>();
  for (const agent of agents) if (!raw.has(agent.name)) raw.set(agent.name, agent);

  const resolve = (name: string, seen: Set<string>): Agent => {
    const agent = raw.get(name)!;
    if (!agent.extends) return agent;
    if (seen.has(name)) throw new Error(`AgentRegistry: "extends" cycle at "${name}"`);
    const base = raw.get(agent.extends);
    if (!base) throw new Error(`AgentRegistry: "${name}" extends unknown agent "${agent.extends}"`);
    return merge(resolve(agent.extends, new Set(seen).add(name)), agent);
  };

  const byName = new Map<string, Agent>();
  for (const name of raw.keys()) byName.set(name, resolve(name, new Set()));

  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
  };
};
