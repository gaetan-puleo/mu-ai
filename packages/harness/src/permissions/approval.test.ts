import { assertEquals } from '@std/assert';
import type { ApprovalCall } from './approval';
import { requireApproval } from './approval';

const call = { name: 'bash', input: { cmd: 'rm' } };
const fixedId = () => 'appr-1';

Deno.test('requireApproval: prompt approves => lets it through (void)', async () => {
  const hook = requireApproval({ needsApproval: () => true, prompt: () => true, newId: fixedId });
  assertEquals(await hook.beforeToolCall?.(call), undefined);
});

Deno.test('requireApproval: the prompt receives an id + name + input', async () => {
  let seen: ApprovalCall | undefined;
  const hook = requireApproval({
    needsApproval: () => true,
    newId: fixedId,
    prompt: (c) => {
      seen = c;
      return true;
    },
  });
  await hook.beforeToolCall?.(call);
  assertEquals(seen, { id: 'appr-1', name: 'bash', input: { cmd: 'rm' } });
});

Deno.test('requireApproval: prompt rejects => blocks with a result', async () => {
  const hook = requireApproval({ needsApproval: () => true, prompt: () => Promise.resolve(false), newId: fixedId });
  assertEquals(await hook.beforeToolCall?.(call), [{ type: 'text', text: 'Denied: bash' }]);
});

Deno.test('requireApproval: not applicable => asks nothing (no id generated)', async () => {
  let asked = false;
  const hook = requireApproval({
    needsApproval: () => false,
    prompt: () => {
      asked = true;
      return true;
    },
  });
  assertEquals(await hook.beforeToolCall?.(call), undefined);
  assertEquals(asked, false);
});

Deno.test('requireApproval: onDeny receives the id and customizes the denial', async () => {
  const hook = requireApproval({
    needsApproval: () => true,
    newId: fixedId,
    prompt: () => false,
    onDeny: (c) => [{ type: 'text', text: `refuse ${c.name} (${c.id})` }],
  });
  assertEquals(await hook.beforeToolCall?.(call), [{ type: 'text', text: 'refuse bash (appr-1)' }]);
});
