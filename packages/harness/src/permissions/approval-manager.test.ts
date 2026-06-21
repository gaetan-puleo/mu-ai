import { expect, test } from 'vitest';
import { createApprovalManager } from './approval-manager';

const call = { name: 'bash', input: { cmd: 'rm' } };

test('approval manager: pending tracks an in-flight request until resolved', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  const pending = mgr.hooks.beforeToolCall?.(call);
  await Promise.resolve();
  expect(mgr.pending().map((p) => p.name)).toEqual(['bash']);
  const id = mgr.pending()[0].id;
  expect(mgr.resolve(id, 'approve')).toEqual(true);
  expect(await pending).toEqual(undefined);
  expect(mgr.pending()).toEqual([]);
});

test('approval manager: deny blocks the call with a result', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  const pending = mgr.hooks.beforeToolCall?.(call);
  await Promise.resolve();
  mgr.resolve(mgr.pending()[0].id, 'deny');
  expect(await pending).toEqual([{ type: 'text', text: 'Denied: bash' }]);
});

test('approval manager: approve_always skips later calls to the same tool', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  const first = mgr.hooks.beforeToolCall?.(call);
  await Promise.resolve();
  mgr.resolve(mgr.pending()[0].id, 'approve_always');
  await first;
  expect(await mgr.hooks.beforeToolCall?.(call)).toEqual(undefined);
  expect(mgr.pending()).toEqual([]);
});

test('approval manager: tools outside askTools are never gated', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  expect(await mgr.hooks.beforeToolCall?.({ name: 'read', input: {} })).toEqual(undefined);
  expect(mgr.pending()).toEqual([]);
});

test('approval manager: subscribe is notified on each request', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  const seen: string[] = [];
  const unsub = mgr.subscribe((req) => seen.push(req.id));
  const pending = mgr.hooks.beforeToolCall?.(call);
  await Promise.resolve();
  mgr.resolve(mgr.pending()[0].id, 'approve');
  await pending;
  expect(seen.length).toEqual(1);
  unsub();
});

test('hooksFor: an "allow" decision passes without prompting', async () => {
  const mgr = createApprovalManager();
  const hooks = mgr.hooksFor({ decide: () => 'allow', agent: () => 'build' });
  expect(await hooks.beforeToolCall?.(call)).toEqual(undefined);
  expect(mgr.pending()).toEqual([]);
});

test('hooksFor: a "deny" decision blocks without prompting', async () => {
  const mgr = createApprovalManager();
  const hooks = mgr.hooksFor({ decide: () => 'deny', agent: () => 'build' });
  expect(await hooks.beforeToolCall?.(call)).toEqual([{ type: 'text', text: 'Denied: bash' }]);
  expect(mgr.pending()).toEqual([]);
});

test('hooksFor: an "ask" decision prompts, stamps the agent, and runs on approve', async () => {
  const mgr = createApprovalManager();
  const hooks = mgr.hooksFor({ decide: () => 'ask', agent: () => 'build' });
  const pending = hooks.beforeToolCall?.(call);
  await Promise.resolve();
  expect(mgr.pending()[0].agent).toEqual('build');
  mgr.resolve(mgr.pending()[0].id, 'approve');
  expect(await pending).toEqual(undefined);
});

test('hooksFor: approve_always is scoped per agent', async () => {
  const mgr = createApprovalManager();
  const build = mgr.hooksFor({ decide: () => 'ask', agent: () => 'build' });
  const plan = mgr.hooksFor({ decide: () => 'ask', agent: () => 'plan' });

  const first = build.beforeToolCall?.(call);
  await Promise.resolve();
  mgr.resolve(mgr.pending()[0].id, 'approve_always');
  await first;

  expect(await build.beforeToolCall?.(call)).toEqual(undefined);
  expect(mgr.pending()).toEqual([]);

  const other = plan.beforeToolCall?.(call);
  await Promise.resolve();
  expect(mgr.pending()[0].agent).toEqual('plan');
  mgr.resolve(mgr.pending()[0].id, 'deny');
  expect(await other).toEqual([{ type: 'text', text: 'Denied: bash' }]);
});
