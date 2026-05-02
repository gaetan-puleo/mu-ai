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
import type { UIService } from './ui';

type StatusListener = () => void;

export interface PluginRegistryOptions {
  cwd: string;
  config: Record<string, unknown>;
  /** Host-supplied UI service. Forwarded to every plugin via `PluginContext.ui`. */
  ui?: UIService;
  /** Host-supplied graceful shutdown. Forwarded via `PluginContext.shutdown`. */
  shutdown?: (code?: number) => Promise<void> | void;
}

/**
 * Owns plugin lifecycle, dispatch, and aggregated state.
 *
 * Plugin loading from a path is deliberately NOT a registry concern — host
 * applications (e.g. mu-coding) implement their own loaders and call
 * `register()` directly. This keeps the registry focused on lifecycle/dispatch
 * and free of file-system / module-resolution dependencies.
 */
export class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map();
  private context: PluginContext;
  private statusSegmentsByPlugin: Map<string, StatusSegment[]> = new Map();
  private statusListeners: Set<StatusListener> = new Set();

  constructor(options: PluginRegistryOptions) {
    this.context = {
      cwd: options.cwd,
      config: options.config,
      ui: options.ui,
      shutdown: options.shutdown,
      getPlugin: <T extends Plugin>(name: string) => this.plugins.get(name) as T | undefined,
    };
  }

  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
    if (plugin.activate) {
      // Per-plugin context with a setStatusLine bound to this plugin's name so
      // segments from one plugin can never overwrite another's.
      const pluginContext: PluginContext = {
        ...this.context,
        setStatusLine: (segments) => this.setStatusLine(plugin.name, segments),
      };
      await plugin.activate(pluginContext);
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
    if (this.statusSegmentsByPlugin.delete(name)) {
      this.emitStatus();
    }
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

  /** Look up a tool by its function name, or `undefined` if no plugin registers one. */
  getTool(name: string): PluginTool | undefined {
    for (const plugin of this.plugins.values()) {
      const tool = plugin.tools?.find((t) => t.definition.function.name === name);
      if (tool) return tool;
    }
    return undefined;
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

  /** Aggregate of every plugin's most recently pushed status segments, in registration order. */
  getStatusSegments(): StatusSegment[] {
    const segments: StatusSegment[] = [];
    for (const plugin of this.plugins.values()) {
      const pluginSegments = this.statusSegmentsByPlugin.get(plugin.name);
      if (pluginSegments?.length) {
        segments.push(...pluginSegments);
      }
    }
    return segments;
  }

  /**
   * Subscribe to status segment changes. Returns an unsubscribe fn. The listener
   * fires whenever any plugin pushes (or clears) its segments.
   */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getAgentLoop(): AgentLoopStrategy | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.agentLoop) {
        return plugin.agentLoop;
      }
    }
    return undefined;
  }

  async shutdown(): Promise<void> {
    for (const name of Array.from(this.plugins.keys()).reverse()) {
      await this.unregister(name);
    }
  }

  private setStatusLine(pluginName: string, segments: StatusSegment[]): void {
    if (segments.length === 0) {
      const removed = this.statusSegmentsByPlugin.delete(pluginName);
      if (removed) this.emitStatus();
      return;
    }
    const prev = this.statusSegmentsByPlugin.get(pluginName);
    if (prev && segmentsEqual(prev, segments)) {
      return;
    }
    this.statusSegmentsByPlugin.set(pluginName, segments);
    this.emitStatus();
  }

  private emitStatus(): void {
    for (const listener of this.statusListeners) {
      listener();
    }
  }
}

function segmentsEqual(a: StatusSegment[], b: StatusSegment[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text || a[i].color !== b[i].color || a[i].dim !== b[i].dim) {
      return false;
    }
  }
  return true;
}
