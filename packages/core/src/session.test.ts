import { Session } from './session';

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Session tests are small and kept together for readability.
describe('Session', () => {
  it('should create a session with config', () => {
    const session = new Session('test-1', { system: 'You are helpful.' });

    expect(session.id).toBe('test-1');
    expect(session.system).toBe('You are helpful.');
    expect(session.state).toBe('idle');
  });

  it('should have no system message by default', () => {
    const session = new Session('test-2');
    expect(session.system).toBeUndefined();
  });

  it('should append and get messages', () => {
    const session = new Session('test-3');

    session.append({ role: 'user', content: 'Hello' });
    session.append({ role: 'assistant', content: 'Hi' });

    expect(session.messages).toHaveLength(2);
    expect(session.getLastMessage()?.content).toBe('Hi');
  });

  it('should return undefined for getLastMessage when empty', () => {
    const session = new Session('test-4');
    expect(session.getLastMessage()).toBeUndefined();
  });

  it('should set and get system message', () => {
    const session = new Session('test-5');

    session.system = 'You are a coding assistant.';
    expect(session.system).toBe('You are a coding assistant.');
  });

  it('should fork a session', () => {
    const session = new Session('test-6');
    session.append({ role: 'user', content: 'Hello' });

    const forked = session.fork();

    expect(forked.messages).toHaveLength(1);
    expect(forked.messages[0].content).toBe('Hello');
    expect(forked.id).not.toBe(session.id);
  });

  it('should forked session be independent', () => {
    const session = new Session('test-7');
    session.append({ role: 'user', content: 'Hello' });

    const forked = session.fork();
    forked.append({ role: 'assistant', content: 'Hi' });

    expect(session.messages).toHaveLength(1);
    expect(forked.messages).toHaveLength(2);
  });

  it('should set and get state', () => {
    const session = new Session('test-8');

    session.state = 'running';
    expect(session.state).toBe('running');

    session.state = 'paused';
    expect(session.state).toBe('paused');
  });

  it('should have no parent by default', () => {
    const session = new Session('test-9');
    expect(session.parentId).toBeUndefined();
  });

  it('should get parent id from config', () => {
    const session = new Session('child-1', { parentId: 'parent-1' });
    expect(session.parentId).toBe('parent-1');
  });

  it('should set parent id on forked session', () => {
    const session = new Session('parent-2');
    session.append({ role: 'user', content: 'Hello' });

    const forked = session.fork();

    expect(forked.parentId).toBe('parent-2');
  });

  it('should chain parent ids through multiple forks', () => {
    const root = new Session('root');
    const fork1 = root.fork();
    const fork2 = fork1.fork();

    expect(fork1.parentId).toBe('root');
    expect(fork2.parentId).toBe(fork1.id);
  });
});
