import { matchesGlob } from 'node:path';
import type { Agent, GrantValue, ToolDecision, ToolGrants } from './types';

export interface AgentRegistry {
  list(): Agent[];
  get(name: string): Agent | undefined;
  add(agent: Agent): void;
  replaceAll(agents: Agent[]): void;
}

const asMap = (grants: ToolGrants | undefined): Record<string, GrantValue> | undefined => {
  if (!grants) return undefined;
  if (Array.isArray(grants)) return Object.fromEntries(grants.map((name) => [name, 'allow' as GrantValue]));
  return grants;
};

const matchKey = (keys: string[], name: string): string | undefined => {
  if (keys.includes(name)) return name;
  let glob: string | undefined;
  for (const key of keys) {
    if (key === '*' || key === name) continue;
    if (matchesGlob(name, key) && (glob === undefined || key.length > glob.length)) glob = key;
  }
  if (glob !== undefined) return glob;
  return keys.includes('*') ? '*' : undefined;
};

const resolveGrant = (grants: ToolGrants | undefined, tool: string, arg?: string): ToolDecision => {
  const map = asMap(grants);
  if (!map) return 'allow';
  const key = matchKey(Object.keys(map), tool);
  if (key === undefined) return 'deny';
  const value = map[key];
  if (typeof value === 'string') return value;
  if (arg === undefined) return 'allow';
  const inner = matchKey(Object.keys(value), arg);
  return inner === undefined ? 'deny' : value[inner];
};

const grantNames = (grants: ToolGrants | undefined): string[] | undefined => {
  const map = asMap(grants);
  if (!map) return undefined;
  const wildcard = map['*'];
  if (wildcard !== undefined && wildcard !== 'deny') return ['*'];
  return Object.entries(map).filter(([, value]) => value !== 'deny').map(([name]) => name);
};

const GRANT_ARG: Record<string, string> = { skill: 'name', bash: 'command' };

export const grantArg = (tool: string, input: unknown): string | undefined => {
  const field = GRANT_ARG[tool];
  if (!field || typeof input !== 'object' || input === null) return undefined;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
};

export const toolDecision = (agent: Agent, tool: string, arg?: string): ToolDecision =>
  resolveGrant(agent.tools, tool, arg);
export const toolNames = (agent: Agent): string[] | undefined => grantNames(agent.tools);

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
  const byName = new Map<string, Agent>();

  const resolve = (name: string, seen: Set<string>): Agent => {
    const agent = raw.get(name)!;
    if (!agent.extends) return agent;
    if (seen.has(name)) throw new Error(`AgentRegistry: "extends" cycle at "${name}"`);
    const base = raw.get(agent.extends);
    if (!base) throw new Error(`AgentRegistry: "${name}" extends unknown agent "${agent.extends}"`);
    return merge(resolve(agent.extends, new Set(seen).add(name)), agent);
  };

  // Rebuild both maps in place so existing holders of this registry see the new set.
  const load = (list: Agent[]): void => {
    raw.clear();
    for (const agent of list) if (!raw.has(agent.name)) raw.set(agent.name, agent);
    byName.clear();
    for (const name of raw.keys()) byName.set(name, resolve(name, new Set()));
  };

  load(agents);

  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
    add: (agent) => {
      raw.set(agent.name, agent);
      byName.set(agent.name, resolve(agent.name, new Set()));
      for (const [name, a] of raw) if (a.extends === agent.name) byName.set(name, resolve(name, new Set()));
    },
    replaceAll: (list) => load(list),
  };
};
