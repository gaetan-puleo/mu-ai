import { describe, expect, it, mock } from 'bun:test';
import { newMessage, type PluginAPI, type Session, type TurnEvent } from 'mu-core';
import type { Agent } from './markdown';
import { createSubAgentBus } from './subAgentBus';
import { runSubAgent, type SubAgentDeps } from './subagent';

function mockSession(id: string): Session {
  const listeners = new Set<(event: import('mu-core').SessionEvent) => void>();
  return {
    id,
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event: import('mu-core').SessionEvent) {
      for (const fn of listeners) {
        try {
          fn(event);
        } catch {
          /* swallow */
        }
      }
    },
    abort() {},
    end() {},
    messages: () => [],
    append: mock(async (msg: import('mu-core').Message) => msg),
    clear() {},
  } as unknown as Session;
}

function mockApi(childSession: Session): PluginAPI {
  return {
    createSession: mock(() => childSession),
    getTool: mock(() => undefined),
    getTools: mock(() => []),
    getProvider: mock(() => undefined),
    getSession: mock(() => undefined),
    listSessions: mock(() => []),
    listCommands: mock(() => []),
    getCommand: mock(() => undefined),
    hook: mock(() => () => {}),
    tool: mock(() => () => {}),
    provider: mock(() => () => {}),
    channel: mock(() => () => {}),
    command: mock(() => () => {}),
    systemPrompt: mock(() => () => {}),
    onSession: mock(() => () => {}),
    config: {},
  } as unknown as PluginAPI;
}

function makeAgent(name: string, kind: 'primary' | 'subagent' = 'subagent'): Agent {
  return {
    name,
    description: `${name} agent`,
    prompt: `You are the ${name} agent.`,
    tools: ['*'],
    kind,
  };
}

async function* emptyRun(): AsyncGenerator<TurnEvent> {
  yield {
    type: 'message',
    message: newMessage({ role: 'assistant', content: 'done' }),
  };
  yield { type: 'turn_end', reason: 'complete' };
}

describe('runSubAgent', () => {
  it('calls bindAgentToSession after creating the child session', async () => {
    const exploreAgent = makeAgent('explore');
    const agents = new Map<string, Agent>([['explore', exploreAgent]]);
    const bus = createSubAgentBus();
    const parentSession = mockSession('parent-1');
    const childSession = mockSession('child-1');

    // Make child.run return a completed turn
    (childSession as any).run = mock(() => emptyRun());

    const bindAgentToSession = mock((_session: Session, _agentName: string) => {});
    const unbindAgentFromSession = mock((_session: Session) => {});

    const deps: SubAgentDeps = {
      api: mockApi(childSession),
      agents,
      bus,
      inFlight: new Set(),
      bindAgentToSession,
      unbindAgentFromSession,
    };

    await runSubAgent({ parentSession, agentName: 'explore', task: 'find the API route' }, deps);

    expect(bindAgentToSession).toHaveBeenCalledTimes(1);
    expect(bindAgentToSession.mock.calls[0][1]).toBe('explore');
  });

  it('calls unbindAgentFromSession in finally block', async () => {
    const exploreAgent = makeAgent('explore');
    const agents = new Map<string, Agent>([['explore', exploreAgent]]);
    const bus = createSubAgentBus();
    const parentSession = mockSession('parent-1');
    const childSession = mockSession('child-1');

    (childSession as any).run = mock(() => emptyRun());

    const bindAgentToSession = mock((_session: Session, _agentName: string) => {});
    const unbindAgentFromSession = mock((_session: Session) => {});

    const deps: SubAgentDeps = {
      api: mockApi(childSession),
      agents,
      bus,
      inFlight: new Set(),
      bindAgentToSession,
      unbindAgentFromSession,
    };

    await runSubAgent({ parentSession, agentName: 'explore', task: 'find something' }, deps);

    expect(unbindAgentFromSession).toHaveBeenCalledTimes(1);
  });

  it('calls unbindAgentFromSession even when run fails', async () => {
    const exploreAgent = makeAgent('explore');
    const agents = new Map<string, Agent>([['explore', exploreAgent]]);
    const bus = createSubAgentBus();
    const parentSession = mockSession('parent-1');
    const childSession = mockSession('child-1');

    // Make child.run throw
    (childSession as any).run = mock(() => {
      throw new Error('LLM connection failed');
    });

    const bindAgentToSession = mock((_s: Session, _a: string) => {});
    const unbindAgentFromSession = mock((_s: Session) => {});

    const api = mockApi(childSession);

    const deps: SubAgentDeps = {
      api,
      agents,
      bus,
      inFlight: new Set(),
      bindAgentToSession,
      unbindAgentFromSession,
    };

    // runSubAgent catches errors internally and returns a result with error
    const result = await runSubAgent({ parentSession, agentName: 'explore', task: 'will fail' }, deps);

    // Even on error, unbindAgentFromSession should be called
    expect(unbindAgentFromSession).toHaveBeenCalledTimes(1);
    expect(result.error).toBeTruthy();
  });

  it('works without bindAgentToSession/unbindAgentFromSession (backward compat)', async () => {
    const exploreAgent = makeAgent('explore');
    const agents = new Map<string, Agent>([['explore', exploreAgent]]);
    const bus = createSubAgentBus();
    const parentSession = mockSession('parent-1');
    const childSession = mockSession('child-1');

    (childSession as any).run = mock(() => emptyRun());

    // SubAgentDeps without the new optional callbacks
    const deps: SubAgentDeps = {
      api: mockApi(childSession),
      agents,
      bus,
      inFlight: new Set(),
    };

    const result = await runSubAgent({ parentSession, agentName: 'explore', task: 'find something' }, deps);

    expect(result.agentName).toBe('explore');
    expect(result.content).toBe('done');
    expect(result.error).toBeUndefined();
  });
});
