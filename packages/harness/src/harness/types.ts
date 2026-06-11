import type { Provider } from 'mu-core';
import type { Agent, AgentRegistry, ToolDecision } from '../agents';
import type { CommandRegistry } from '../commands';
import type { HarnessConfig, HarnessConfigOptions } from '../config';
import type { ApprovalManager } from '../permissions';
import type { PluginStore } from '../plugin';
import type { Scheduler, TaskStore } from '../scheduler';
import type { AgentSessionConfig, SessionManager } from '../session';
import type { Skill, SkillRegistry } from '../skills';
import type { SubAgentRegistry, SubAgentResult } from '../subAgents';
import type { ModelRegistry } from './models';

export type HarnessOptions =
  & HarnessConfigOptions
  & Omit<AgentSessionConfig, 'provider' | 'model' | 'id' | 'messages'>
  & {
    providers: Record<string, Provider>;
    model: string;
    agents?: Agent[];
    defaultAgents?: Agent[];
    skills?: Skill[];
    agentDirs?: { local?: string; config?: string };
    title?: boolean;
    titleModel?: string;
    cwd?: string;
    sourceUrl?: string;
    scheduler?: boolean;
    approvals?: {
      manager: ApprovalManager;
      activeAgent: () => Agent | undefined;
      decide?: (agent: Agent, call: { name: string; input: unknown }) => ToolDecision;
    };
  };

export interface Harness {
  readonly config: HarnessConfig;
  readonly models: ModelRegistry;
  readonly plugins: PluginStore;
  readonly sessions: SessionManager;
  readonly agents: AgentRegistry;
  readonly skills: SkillRegistry;
  readonly subAgents: SubAgentRegistry;
  dispatchSubAgent(agent: string, task: string, parentId: string): Promise<SubAgentResult>;
  reloadDefinitions(): Promise<void>;
  readonly commands: CommandRegistry;
  readonly scheduler?: Scheduler;
  readonly tasks?: TaskStore;
  readonly cwd: string;
  close(): void;
}
