import type { ToolDefinition } from 'mu-provider';
import type {
  AgentLoopStrategy,
  LifecycleHooks,
  MentionProvider,
  MessageBus,
  MessageRenderer,
  Plugin,
  PluginContext,
  PluginTool,
  ShortcutHandler,
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
  /** Host-supplied message bus. Forwarded via `PluginContext.messages`. */
  messages?: MessageBus;
}

interface RendererEntry {
  plugin: string;
  customType: string;
  renderer: MessageRenderer;
}

interface ShortcutEntry {
  plugin: string;
  key: string;
  handler: ShortcutHandler;
}

interface MentionEntry {
  plugin: string;
  trigger: string;
  provider: MentionProvider;
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
  private renderers: RendererEntry[] = [];
  private shortcuts: ShortcutEntry[] = [];
  private mentions: MentionEntry[] = [];
  private rendererListeners: Set<() => void> = new Set();
  private shortcutListeners: Set<() => void> = new Set();
  private mentionListeners: Set<() => void> = new Set();

  constructor(options: PluginRegistryOptions) {
    this.context = {
      cwd: options.cwd,
      config: options.config,
      ui: options.ui,
      shutdown: options.shutdown,
      messages: options.messages,
      getPlugin: <T extends Plugin>(name: string) => this.plugins.get(name) as T | undefined,
    };
  }

  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
    if (plugin.activate) {
      await plugin.activate(this.buildPluginContext(plugin.name));
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
    this.dropPluginRegistrations(name);
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

  /**
   * Return the tool set after every `filterTools` hook has narrowed it.
   * Hooks compose by passing each plugin's output as the next input, so the
   * effective set is the intersection of every plugin's allowed tools.
   */
  async getFilteredTools(): Promise<PluginTool[]> {
    let current = this.getTools();
    for (const plugin of this.plugins.values()) {
      const hook = plugin.hooks?.filterTools;
      if (!hook) continue;
      current = await hook(current);
    }
    return current;
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

  /** Run every `transformSystemPrompt` hook in registration order. */
  async applySystemPromptTransforms(prompt: string): Promise<string> {
    let current = prompt;
    for (const plugin of this.plugins.values()) {
      const hook = plugin.hooks?.transformSystemPrompt;
      if (!hook) continue;
      current = await hook(current);
    }
    return current;
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

  // ─── Renderer / Shortcut / Mention registries ─────────────────────────────

  /** Renderer for `customType`. The first match wins (registration order). */
  getRenderer(customType: string): MessageRenderer | undefined {
    return this.renderers.find((r) => r.customType === customType)?.renderer;
  }

  /** Snapshot of every registered `customType → renderer`. First registration wins. */
  getRenderers(): Map<string, MessageRenderer> {
    const out = new Map<string, MessageRenderer>();
    for (const entry of this.renderers) {
      if (!out.has(entry.customType)) {
        out.set(entry.customType, entry.renderer);
      }
    }
    return out;
  }

  onRenderersChange(listener: () => void): () => void {
    this.rendererListeners.add(listener);
    return () => {
      this.rendererListeners.delete(listener);
    };
  }

  getShortcuts(): ReadonlyArray<{ key: string; handler: ShortcutHandler; plugin: string }> {
    return this.shortcuts;
  }

  onShortcutsChange(listener: () => void): () => void {
    this.shortcutListeners.add(listener);
    return () => {
      this.shortcutListeners.delete(listener);
    };
  }

  getMentionProviders(): ReadonlyArray<{ trigger: string; provider: MentionProvider; plugin: string }> {
    return this.mentions;
  }

  onMentionProvidersChange(listener: () => void): () => void {
    this.mentionListeners.add(listener);
    return () => {
      this.mentionListeners.delete(listener);
    };
  }

  async shutdown(): Promise<void> {
    for (const name of Array.from(this.plugins.keys()).reverse()) {
      await this.unregister(name);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private buildPluginContext(pluginName: string): PluginContext {
    return {
      ...this.context,
      registry: {
        getTools: () => this.getTools(),
        getFilteredTools: () => this.getFilteredTools(),
        getHooks: () => this.getHooks(),
        getSystemPrompts: () => this.getSystemPrompts(),
        applySystemPromptTransforms: (prompt) => this.applySystemPromptTransforms(prompt),
      },
      setStatusLine: (segments) => this.setStatusLine(pluginName, segments),
      registerMessageRenderer: (customType, renderer) => this.addRenderer(pluginName, customType, renderer),
      registerShortcut: (key, handler) => this.addShortcut(pluginName, key, handler),
      registerMentionProvider: (trigger, provider) => this.addMention(pluginName, trigger, provider),
    };
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

  private addRenderer(plugin: string, customType: string, renderer: MessageRenderer): () => void {
    const entry: RendererEntry = { plugin, customType, renderer };
    this.renderers.push(entry);
    this.emitRenderers();
    return () => {
      const idx = this.renderers.indexOf(entry);
      if (idx >= 0) {
        this.renderers.splice(idx, 1);
        this.emitRenderers();
      }
    };
  }

  private addShortcut(plugin: string, key: string, handler: ShortcutHandler): () => void {
    const entry: ShortcutEntry = { plugin, key, handler };
    this.shortcuts.push(entry);
    this.emitShortcuts();
    return () => {
      const idx = this.shortcuts.indexOf(entry);
      if (idx >= 0) {
        this.shortcuts.splice(idx, 1);
        this.emitShortcuts();
      }
    };
  }

  private addMention(plugin: string, trigger: string, provider: MentionProvider): () => void {
    const entry: MentionEntry = { plugin, trigger, provider };
    this.mentions.push(entry);
    this.emitMentions();
    return () => {
      const idx = this.mentions.indexOf(entry);
      if (idx >= 0) {
        this.mentions.splice(idx, 1);
        this.emitMentions();
      }
    };
  }

  private dropPluginRegistrations(plugin: string): void {
    const beforeR = this.renderers.length;
    this.renderers = this.renderers.filter((r) => r.plugin !== plugin);
    if (this.renderers.length !== beforeR) this.emitRenderers();

    const beforeS = this.shortcuts.length;
    this.shortcuts = this.shortcuts.filter((s) => s.plugin !== plugin);
    if (this.shortcuts.length !== beforeS) this.emitShortcuts();

    const beforeM = this.mentions.length;
    this.mentions = this.mentions.filter((m) => m.plugin !== plugin);
    if (this.mentions.length !== beforeM) this.emitMentions();
  }

  private emitRenderers(): void {
    for (const fn of this.rendererListeners) fn();
  }
  private emitShortcuts(): void {
    for (const fn of this.shortcutListeners) fn();
  }
  private emitMentions(): void {
    for (const fn of this.mentionListeners) fn();
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
