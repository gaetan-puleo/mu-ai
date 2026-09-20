import { expect, test } from 'vitest';
import type { ApprovalCall } from './approval';
import { requireApproval } from './approval';

const call = { name: 'bash', input: { cmd: 'rm' } };
const fixedId = () => 'appr-1';

test('requireApproval: prompt approves => lets it through (void)', async () => {
  const hook = requireApproval({ needsApproval: () => true, prompt: () => true, newId: fixedId });
  expect(await hook.beforeToolCall?.(call)).toEqual(undefined);
});

test('requireApproval: the prompt receives an id + name + input', async () => {
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
  expect(seen).toEqual({ id: 'appr-1', name: 'bash', input: { cmd: 'rm' } });
});

test('requireApproval: prompt rejects => blocks with a result', async () => {
  const hook = requireApproval({ needsApproval: () => true, prompt: () => Promise.resolve(false), newId: fixedId });
  expect(await hook.beforeToolCall?.(call)).toEqual([{ type: 'text', text: 'Denied: bash' }]);
});

test('requireApproval: not applicable => asks nothing (no id generated)', async () => {
  let asked = false;
  const hook = requireApproval({
    needsApproval: () => false,
    prompt: () => {
      asked = true;
      return true;
    },
  });
  expect(await hook.beforeToolCall?.(call)).toEqual(undefined);
  expect(asked).toEqual(false);
});

test('requireApproval: onDeny receives the id and customizes the denial', async () => {
  const hook = requireApproval({
    needsApproval: () => true,
    newId: fixedId,
    prompt: () => false,
    onDeny: (c) => [{ type: 'text', text: `refuse ${c.name} (${c.id})` }],
  });
  expect(await hook.beforeToolCall?.(call)).toEqual([{ type: 'text', text: 'refuse bash (appr-1)' }]);
});
