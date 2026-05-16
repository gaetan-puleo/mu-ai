import { Text } from 'ink';
import type { KeybindChannel } from 'mu-agents';
import type { Session } from 'mu-core';
import { Mu } from 'mu-core';
import { detectServer, formatModelId, parseModelId } from 'mu-local-provider';
import { assemblePlugins } from '../plugins';
import { loadCodingSystemPrompt } from '../systemPrompt';
import { tuiApprovalChannel } from './approvalBridge';
import {
  ACTIVE_MODEL_BRIDGE,
  AGENT_COLOR_BRIDGE,
  CTX_BRIDGE,
  CURRENT_SESSION_BRIDGE,
  MODEL_CHANGE_BRIDGE,
} from './bridges';
import { createTuiChannelPlugin } from './channel';
import { pickModelInteractive } from './components/ModelPicker';
import { TUI_KEYBINDS, TUI_SLOTS } from './primitives';

export interface RunTuiOptions {
  baseUrl: string;
  model?: string;
  plugins?: readonly string[];
}

export async function runTui(opts: RunTuiOptions): Promise<void> {
  const serverInfo = await detectServer(opts.baseUrl);
  if (serverInfo.kind === 'unknown') {
    process.stderr.write(
      `[mu] could not detect a supported local server at ${opts.baseUrl} (probed /running, /props); context-usage display will be limited.\n`,
    );
  }

  let qualifiedModel: string | undefined;
  if (opts.model) {
    const parsed = parseModelId(opts.model);
    if (parsed.kind && parsed.kind !== serverInfo.kind) {
      process.stderr.write(
        `[mu] model "${opts.model}" claims kind "${parsed.kind}" but server is "${serverInfo.kind}"; using detection.\n`,
      );
    }
    qualifiedModel = formatModelId({ kind: serverInfo.kind, id: parsed.id });
  } else {
    const picked = await pickModelInteractive(opts.baseUrl, serverInfo);
    if (!picked) return;
    qualifiedModel = picked;
  }
  const model = qualifiedModel;
  ACTIVE_MODEL_BRIDGE.value = model;

  await new Promise<void>((resolveClosed) => {
    let muRef: Mu | null = null;
    const slotDetachers: Array<() => void> = [];

    const keybindChannel: KeybindChannel = {
      registry: TUI_KEYBINDS,
      currentSession: (): Session | null => CURRENT_SESSION_BRIDGE.get?.() ?? null,
    };

    const { plugins, agentsHandle, localProviderHandle } = assemblePlugins({
      configPlugins: opts.plugins ?? [],
      approval: tuiApprovalChannel,
      keybinds: keybindChannel,
    });

    const tuiPlugin = createTuiChannelPlugin({
      baseUrl: opts.baseUrl,
      model,
      serverInfo,
      agentsHandle,
      onClosed: () => {
        void (async () => {
          try {
            for (const d of slotDetachers) {
              try {
                d();
              } catch {
                /* best-effort */
              }
            }
            slotDetachers.length = 0;
            await muRef?.shutdown();
          } finally {
            resolveClosed();
          }
        })();
      },
    });

    const discoverContextLimit = (qualifiedModelId: string): void => {
      const bare = parseModelId(qualifiedModelId).id;
      void localProviderHandle.getModelInfo(opts.baseUrl, bare).then((info) => {
        CTX_BRIDGE.totalForModel = info.runtimeContextLimit;
        for (const [sid, snap] of CTX_BRIDGE.bySession) {
          CTX_BRIDGE.bySession.set(sid, { ...snap, total: info.runtimeContextLimit });
        }
        TUI_SLOTS.notify();
      });
    };
    discoverContextLimit(model);

    MODEL_CHANGE_BRIDGE.fn = (newModel) => {
      discoverContextLimit(newModel);
      TUI_SLOTS.notify();
    };
    slotDetachers.push(() => {
      if (MODEL_CHANGE_BRIDGE.fn) MODEL_CHANGE_BRIDGE.fn = null;
    });

    if (agentsHandle) {
      AGENT_COLOR_BRIDGE.get = (session) => agentsHandle.getActive(session)?.color;
      slotDetachers.push(() => {
        if (AGENT_COLOR_BRIDGE.get) AGENT_COLOR_BRIDGE.get = null;
      });
      slotDetachers.push(
        TUI_SLOTS.register('assistantLine', () => {
          const session = CURRENT_SESSION_BRIDGE.get?.();
          if (!session) return null;
          const agent = agentsHandle.getActive(session);
          if (!agent) return null;
          const label = agent.name.charAt(0).toUpperCase() + agent.name.slice(1);
          if (agent.color) {
            return (
              <Text color={agent.color} bold={true}>
                {label}
              </Text>
            );
          }
          return label;
        }),
      );
      slotDetachers.push(agentsHandle.onSwitch(() => TUI_SLOTS.notify()));
    }

    slotDetachers.push(TUI_SLOTS.register('assistantLine', () => ACTIVE_MODEL_BRIDGE.value || model));

    const systemPrompt = loadCodingSystemPrompt();
    void Mu.start({
      config: {
        baseUrl: opts.baseUrl,
        model,
        providerId: 'local',
        systemPrompt: systemPrompt || undefined,
      },
      plugins: [...plugins, tuiPlugin],
    }).then((mu) => {
      muRef = mu;
    });
  });
}
