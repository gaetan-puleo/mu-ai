import type { ContentPart, Message, Tool } from 'mu-core';
import type { AgentSession, AgentSessionEvent, SessionRecord } from '../../session';
import type { ApprovalManager, PendingApproval } from '../../permissions';
import type { SubAgentRegistry, SubAgentResult, SubAgentRun } from '../../subAgents';
import type { ChatFeatures, ChatHost, ModelInfo } from '../../tui';
import { createWsClient } from './ws-client';
import { partsToAttachments, textOf, type WireMessage } from './wire';
import type { SubAgentEventWire, WireAgent, WireCommand, WsOutbound } from './protocol';

export interface ConnectHarnessOptions {
  url: string;
  token?: string;
  sessionId?: string;
  cwd: string;
  initialTheme?: string;
  saveTheme?: (name: string) => void;
  initialThinking?: boolean;
  saveThinking?: (visible: boolean) => void;
  history?: { load(): string[]; append(text: string): void };
  banner?: string;
  minimal?: boolean;
  features?: ChatFeatures;
  onExit?: (code: number) => void;
}

interface FakeSession extends AgentSession {
  _emit(event: AgentSessionEvent): void;
  _setMessages(messages: Message[]): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const parseArgs = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

function wireToEvents(wire: WireMessage): AgentSessionEvent[] {
  if (wire.role !== 'assistant') return [];
  const events: AgentSessionEvent[] = [];
  for (const tc of wire.toolCalls ?? []) {
    events.push({ type: 'tool_call', id: tc.id, name: tc.function.name, input: parseArgs(tc.function.arguments) });
  }
  events.push({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: wire.content }] } });
  return events;
}

export interface RemoteHarness {
  host: ChatHost;
  close(): Promise<void>;
}

export async function connectHarness(opts: ConnectHarnessOptions): Promise<RemoteHarness> {
  const client = createWsClient({ url: opts.url, token: opts.token, sessionId: opts.sessionId });

  // Caches hydrated from connect-time frames (feed the synchronous host methods).
  let agents: WireAgent[] = [];
  let activeAgentId: string | null = null;
  let models: ModelInfo[] = [];
  let modelSelected = '';
  let commands: WireCommand[] = [];
  // Mutated in place by the connect-time `capabilities` frame so the host (read once by
  // ChatApp after connect) reflects the server's actual model modalities.
  const features: ChatFeatures = { ...(opts.features ?? {}) };

  const sessionsById = new Map<string, FakeSession>();
  const subSessions = new Map<string, FakeSession>();

  const approvalListeners = new Set<(req: PendingApproval) => void>();
  const subAgentListeners = new Set<(run: SubAgentRun) => void>();
  const modelLoadingListeners = new Set<(model: string, loading: boolean) => void>();

  const forkWaiters = new Map<string, (r: { id: string; messages: Message[] }) => void>();
  const subagentWaiters = new Map<string, { resolve: (r: SubAgentResult) => void; reject: (e: Error) => void }>();
  const listWaiters: ((sessions: SessionRecord[]) => void)[] = [];
  const modelWaiters: ((models: ModelInfo[]) => void)[] = [];
  const rawWaiters = new Map<string, (messages: Message[]) => void>();
  const voiceWaiters = new Map<string, { resolve: (text: string) => void; reject: (e: Error) => void }>();
  const voiceCheckWaiters = new Map<string, (reason: string | undefined) => void>();

  // Settle every request-keyed voice waiter so transcribe()/unavailableReason()
  // never hang when the socket drops (or the server tears the connection down,
  // e.g. an oversized frame). voice:check resolves with a reason string (its
  // contract is `string | undefined`) so the caller shows an error rather than
  // throwing; voice:transcribe rejects.
  const failVoiceWaiters = (message: string): void => {
    const err = new Error(message);
    for (const w of voiceWaiters.values()) w.reject(err);
    voiceWaiters.clear();
    for (const resolve of voiceCheckWaiters.values()) resolve(message);
    voiceCheckWaiters.clear();
    for (const w of subagentWaiters.values()) w.reject(err);
    subagentWaiters.clear();
  };
  client.onClose(() => failVoiceWaiters('connection lost'));

  const agentsReady = deferred<void>();

  const route = (sessionId: string, event: AgentSessionEvent): void => sessionsById.get(sessionId)?._emit(event);

  const applyRaw = (sessionId: string, messages: Message[]): void => {
    sessionsById.get(sessionId)?._setMessages([...messages]);
    rawWaiters.get(sessionId)?.(messages);
    rawWaiters.delete(sessionId);
  };

  const makeFakeSession = (id: string, initial: Message[], readonly = false): FakeSession => {
    let messages = [...initial];
    const listeners = new Set<(e: AgentSessionEvent) => void>();
    return {
      id,
      get messages() {
        return messages;
      },
      tools: [] as readonly Tool[],
      send: (input: string | ContentPart[]) => {
        if (!readonly) {
          if (typeof input === 'string') {
            client.send({ type: 'chat', sessionId: id, text: input });
          } else {
            const attachments = partsToAttachments(input);
            client.send({
              type: 'chat',
              sessionId: id,
              text: textOf(input),
              ...(attachments.length > 0 ? { attachments } : {}),
            });
          }
        }
        return Promise.resolve();
      },
      abort: () => {
        if (!readonly) client.send({ type: 'abort', sessionId: id });
      },
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      _emit: (event) => {
        for (const l of [...listeners]) l(event);
      },
      _setMessages: (m) => {
        messages = m;
      },
    };
  };

  const handleSubAgentEvent = (ev: SubAgentEventWire): void => {
    if (ev.type === 'started') {
      const session = makeFakeSession(ev.runId, [], true);
      subSessions.set(ev.runId, session);
      const run: SubAgentRun = { runId: ev.runId, agent: ev.agentName, parentId: ev.parentSessionId, session };
      for (const l of [...subAgentListeners]) l(run);
      return;
    }
    const session = subSessions.get(ev.runId);
    if (!session) return;
    switch (ev.type) {
      case 'content':
        session._emit({ type: 'text', text: ev.detail ?? '' });
        return;
      case 'tool_call':
        session._emit({
          type: 'tool_call',
          id: crypto.randomUUID(),
          name: ev.detail?.name ?? '',
          input: parseArgs(ev.detail?.arguments ?? '{}'),
        });
        return;
      case 'completed':
        session._setMessages([{ role: 'assistant', content: [{ type: 'text', text: ev.detail?.content ?? '' }] }]);
        session._emit({ type: 'turn_end' });
        subSessions.delete(ev.runId);
        return;
      case 'error':
        session._emit({ type: 'error', error: new Error(ev.detail ?? 'sub-agent error') });
        subSessions.delete(ev.runId);
        return;
      default:
        return;
    }
  };

  const unsub = client.on((frame: WsOutbound) => {
    switch (frame.type) {
      case 'agents':
        agents = frame.agents;
        activeAgentId = frame.activeAgentId ?? null;
        agentsReady.resolve();
        return;
      case 'commands':
        commands = frame.commands;
        return;
      case 'capabilities':
        features.vision = frame.vision;
        features.audio = frame.audio;
        return;
      case 'model_loading':
        for (const l of [...modelLoadingListeners]) l(frame.model, frame.loading);
        return;
      case 'models:listed': {
        models = frame.models.map((m) => ({ id: m.id, ownedBy: m.ownedBy }));
        modelSelected = frame.selected;
        const waiters = modelWaiters.splice(0);
        for (const w of waiters) w(models);
        return;
      }
      case 'sessions:listed': {
        const records: SessionRecord[] = frame.sessions.map((s) => ({
          id: s.id,
          title: s.title,
          cwd: opts.cwd,
          createdAt: s.createdAt,
        }));
        const waiters = listWaiters.splice(0);
        for (const w of waiters) w(records);
        return;
      }
      case 'sessions:raw':
        applyRaw(frame.sessionId, frame.messages);
        return;
      case 'sessions:forked':
        forkWaiters.get(frame.requestId)?.({ id: frame.sessionId, messages: frame.messages });
        forkWaiters.delete(frame.requestId);
        return;
      case 'subagent:result':
        subagentWaiters.get(frame.requestId)?.resolve({ agent: frame.agent, text: frame.text });
        subagentWaiters.delete(frame.requestId);
        return;
      case 'subagent:error':
        subagentWaiters.get(frame.requestId)?.reject(new Error(frame.message));
        subagentWaiters.delete(frame.requestId);
        return;
      case 'voice:availability':
        voiceCheckWaiters.get(frame.requestId)?.(frame.reason);
        voiceCheckWaiters.delete(frame.requestId);
        return;
      case 'voice:result':
        voiceWaiters.get(frame.requestId)?.resolve(frame.text);
        voiceWaiters.delete(frame.requestId);
        return;
      case 'voice:error':
        voiceWaiters.get(frame.requestId)?.reject(new Error(frame.message));
        voiceWaiters.delete(frame.requestId);
        return;
      case 'approval_request': {
        const req: PendingApproval = { id: frame.requestId, name: frame.toolName, input: parseArgs(frame.args) };
        for (const l of [...approvalListeners]) l(req);
        return;
      }
      case 'sub_agent_event':
        handleSubAgentEvent(frame.event);
        return;
      case 'stream':
        route(frame.sessionId, { type: 'text', text: frame.text });
        return;
      case 'reasoning':
        route(frame.sessionId, { type: 'reasoning', text: frame.text });
        return;
      case 'turn_start':
        route(frame.sessionId, { type: 'turn_start', input: { role: 'user', content: [] } });
        return;
      case 'usage':
        route(frame.sessionId, { type: 'usage', usage: frame.usage });
        return;
      case 'message':
        for (const event of wireToEvents(frame.message)) route(frame.sessionId, event);
        return;
      case 'turn_end':
        route(frame.sessionId, { type: 'turn_end' });
        // Resync messages losslessly so /export + model-switch carry-over are faithful.
        if (sessionsById.has(frame.sessionId)) client.send({ type: 'sessions:get', sessionId: frame.sessionId });
        return;
      case 'error':
        if (frame.sessionId) route(frame.sessionId, { type: 'error', error: new Error(frame.message) });
        return;
      default:
        return;
    }
  });

  const approvals: ApprovalManager = {
    hooks: {},
    hooksFor: () => ({}),
    pending: () => [],
    resolve: (id, action) => {
      client.send({ type: 'approval_response', requestId: id, action });
      return true;
    },
    subscribe: (l) => {
      approvalListeners.add(l);
      return () => approvalListeners.delete(l);
    },
  };

  const subAgents: SubAgentRegistry = {
    register: () => {},
    get: () => undefined,
    list: () => [],
    byParent: () => [],
    subscribe: (l) => {
      subAgentListeners.add(l);
      return () => subAgentListeners.delete(l);
    },
  };

  const agentRef = (): string => activeAgentId ?? agents[0]?.name ?? 'agent';

  const requestRaw = (id: string): Promise<Message[]> =>
    new Promise<Message[]>((resolve) => {
      rawWaiters.set(id, resolve);
      client.send({ type: 'sessions:get', sessionId: id });
    });

  const host: ChatHost = {
    // No initial session → ChatApp creates one lazily on the first message.
    approvals,
    cwd: opts.cwd,
    createSession: () => {
      const id = crypto.randomUUID();
      const session = makeFakeSession(id, []);
      sessionsById.set(id, session);
      client.send({ type: 'sessions:create', sessionId: id });
      return session;
    },
    forkSession: async (id, upToIndex) => {
      const requestId = crypto.randomUUID();
      const { id: newId, messages } = await new Promise<{ id: string; messages: Message[] }>((resolve) => {
        forkWaiters.set(requestId, resolve);
        client.send({ type: 'sessions:fork', requestId, sessionId: id, upToIndex });
      });
      const session = makeFakeSession(newId, messages);
      sessionsById.set(newId, session);
      return session;
    },
    listSessions: () =>
      new Promise<SessionRecord[]>((resolve) => {
        listWaiters.push(resolve);
        client.send({ type: 'sessions:list' });
      }),
    openSession: async (id) => {
      const messages = await requestRaw(id);
      const session = makeFakeSession(id, messages);
      sessionsById.set(id, session);
      return session;
    },
    selectModel: (ref) => {
      modelSelected = ref;
      client.send({ type: 'models:select', ref });
    },
    modelRef: () => modelSelected,
    listModels: () =>
      new Promise<ModelInfo[]>((resolve) => {
        modelWaiters.push(resolve);
        client.send({ type: 'models:list' });
      }),
    agentRef,
    agentColor: () => agents.find((a) => a.name === agentRef())?.color,
    cycleAgent: () => agentRef(),
    agentNames: () => agents.map((a) => a.name).filter((n) => n !== agentRef() && n !== 'title'),
    subAgents,
    dispatchSubAgent: (agent, task, parentId) =>
      new Promise<SubAgentResult>((resolve, reject) => {
        const requestId = crypto.randomUUID();
        subagentWaiters.set(requestId, { resolve, reject });
        client.send({ type: 'subagent:dispatch', requestId, agent, task, parentId });
      }),
    initialTheme: opts.initialTheme ?? 'dark',
    saveTheme: opts.saveTheme ?? (() => {}),
    initialThinking: opts.initialThinking ?? false,
    saveThinking: opts.saveThinking ?? (() => {}),
    history: opts.history,
    features,
    subscribeModelLoading: (listener) => {
      modelLoadingListeners.add(listener);
      return () => modelLoadingListeners.delete(listener);
    },
    voice: {
      unavailableReason: () =>
        new Promise<string | undefined>((resolve) => {
          const requestId = crypto.randomUUID();
          voiceCheckWaiters.set(requestId, resolve);
          if (!client.send({ type: 'voice:check', requestId })) {
            voiceCheckWaiters.delete(requestId);
            resolve('voice unavailable: not connected');
          }
        }),
      transcribe: (data, mime) =>
        new Promise<string>((resolve, reject) => {
          const requestId = crypto.randomUUID();
          voiceWaiters.set(requestId, { resolve, reject });
          const sent = client.send({
            type: 'voice:transcribe',
            requestId,
            mime,
            data: Buffer.from(data).toString('base64'),
          });
          if (!sent) {
            voiceWaiters.delete(requestId);
            reject(new Error('not connected'));
          }
        }),
    },
    banner: opts.banner,
    minimal: opts.minimal,
    commands: () => commands.map((c) => ({ name: c.command.replace(/^\//, ''), description: c.description })),
    runCommand: (input) => {
      client.send({ type: 'command', text: input });
      return Promise.resolve({ ok: true });
    },
    onExit: opts.onExit ?? (() => {}),
  };

  await client.connect();
  await agentsReady.promise;

  return {
    host,
    close: async () => {
      unsub();
      await client.close();
    },
  };
}
