import type { ToolDefinition } from 'mu-provider';
import type {
  AgentLoopStrategy,
  LifecycleHooks,
  Plugin,
  PluginContext,
  PluginTool,
  SlashCommand,
  StatusSegment,
} from './plugin';

export class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map();
  private context: PluginContext;

  constructor(context: PluginContext) {
    this.context = {
      ...context,
      getPlugin: <T extends Plugin>(name: string) => this.plugins.get(name) as T | undefined,
    };
  }

  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
    if (plugin.activate) {
      await plugin.activate(this.context);
    }
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return;
    }
    if (plugin.deactivate) {
      await plugin.deactivate();
    }
    this.plugins.delete(name);
  }

  getPlugin<T extends Plugin>(name: string): T | undefined {
    return this.plugins.get(name) as T | undefined;
  }

  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getTools(): PluginTool[] {
    const tools: PluginTool[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.tools) {
        tools.push(...plugin.tools);
      }
    }
    return tools;
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.getTools().map((t) => t.definition);
  }

  async getSystemPrompts(): Promise<string[]> {
    const prompts: string[] = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.systemPrompt) {
        continue;
      }
      if (typeof plugin.systemPrompt === 'string') {
        prompts.push(plugin.systemPrompt);
      } else {
        const result = await plugin.systemPrompt(this.context);
        if (result) {
          prompts.push(result);
        }
      }
    }
    return prompts;
  }

  getHooks(): LifecycleHooks[] {
    const hooks: LifecycleHooks[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.hooks) {
        hooks.push(plugin.hooks);
      }
    }
    return hooks;
  }

  getCommands(): SlashCommand[] {
    const commands: SlashCommand[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.commands) {
        commands.push(...plugin.commands);
      }
    }
    return commands;
  }

  getStatusSegments(): StatusSegment[] {
    const segments: StatusSegment[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.statusLine) {
        segments.push(...plugin.statusLine());
      }
    }
    return segments;
  }

  getAgentLoop(): AgentLoopStrategy | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.agentLoop) {
        return plugin.agentLoop;
      }
    }
    return undefined;
  }

  async loadPlugin(pathOrModule: string, pluginConfig?: Record<string, unknown>): Promise<void> {
    try {
      const mod = await import(pathOrModule);
      const factory = mod.default ?? mod.createPlugin;

      if (typeof factory === 'function') {
        const plugin: Plugin = factory(pluginConfig ?? {});
        await this.register(plugin);
      } else if (isPlugin(mod)) {
        await this.register(mod);
      } else if (isPlugin(mod.default)) {
        await this.register(mod.default);
      } else {
        console.warn(`[plugins] Could not load "${pathOrModule}": no plugin export found`);
      }
    } catch (err) {
      console.warn(`[plugins] Failed to load "${pathOrModule}":`, err instanceof Error ? err.message : err);
    }
  }

  async shutdown(): Promise<void> {
    for (const name of Array.from(this.plugins.keys()).reverse()) {
      await this.unregister(name);
    }
  }
}

function isPlugin(obj: unknown): obj is Plugin {
  return typeof obj === 'object' && obj !== null && 'name' in obj;
}
