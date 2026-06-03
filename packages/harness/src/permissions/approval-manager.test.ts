import { assertEquals } from '@std/assert';
import { createApprovalManager } from './approval-manager';

const call = { name: 'bash', input: { cmd: 'rm' } };

Deno.test('approval manager: pending tracks an in-flight request until resolved', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  const pending = mgr.hooks.beforeToolCall?.(call);
  await Promise.resolve();
  assertEquals(mgr.pending().map((p) => p.name), ['bash']);
  const id = mgr.pending()[0].id;
  assertEquals(mgr.resolve(id, 'approve'), true);
  assertEquals(await pending, undefined);
  assertEquals(mgr.pending(), []);
});

Deno.test('approval manager: deny blocks the call with a result', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  const pending = mgr.hooks.beforeToolCall?.(call);
  await Promise.resolve();
  mgr.resolve(mgr.pending()[0].id, 'deny');
  assertEquals(await pending, [{ type: 'text', text: 'Denied: bash' }]);
});

Deno.test('approval manager: approve_always skips later calls to the same tool', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  const first = mgr.hooks.beforeToolCall?.(call);
  await Promise.resolve();
  mgr.resolve(mgr.pending()[0].id, 'approve_always');
  await first;
  assertEquals(await mgr.hooks.beforeToolCall?.(call), undefined);
  assertEquals(mgr.pending(), []);
});

Deno.test('approval manager: tools outside askTools are never gated', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  assertEquals(await mgr.hooks.beforeToolCall?.({ name: 'read', input: {} }), undefined);
  assertEquals(mgr.pending(), []);
});

Deno.test('approval manager: subscribe is notified on each request', async () => {
  const mgr = createApprovalManager({ askTools: ['bash'] });
  const seen: string[] = [];
  const unsub = mgr.subscribe((req) => seen.push(req.id));
  const pending = mgr.hooks.beforeToolCall?.(call);
  await Promise.resolve();
  mgr.resolve(mgr.pending()[0].id, 'approve');
  await pending;
  assertEquals(seen.length, 1);
  unsub();
});
