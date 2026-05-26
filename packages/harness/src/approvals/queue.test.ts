import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { assertApprovalDecision, createApprovalQueue } from './queue';

describe('createApprovalQueue', () => {
  it('resolves a pending request when the user allows', async () => {
    const queue = createApprovalQueue();
    const pending = queue.request('Read', '{}');
    const id = queue.pending()[0].id;
    queue.resolve(id, 'allow');
    expect(await pending).toBe('allow');
  });

  it('resolves a pending request when the user denies', async () => {
    const queue = createApprovalQueue();
    const pending = queue.request('Read', '{}');
    const id = queue.pending()[0].id;
    queue.resolve(id, 'deny');
    expect(await pending).toBe('deny');
  });

  it('throws when resolved with an unknown decision string', () => {
    const queue = createApprovalQueue();
    queue.request('Read', '{}');
    const id = queue.pending()[0].id;
    expect(() => queue.resolve(id, 'ALLOW' as unknown as 'allow')).toThrow(/Invalid approval decision/);
    expect(() => queue.resolve(id, 'allow ' as unknown as 'allow')).toThrow(/Invalid approval decision/);
    expect(() => queue.resolve(id, 'yes' as unknown as 'allow')).toThrow(/Invalid approval decision/);
  });

  it('leaves the request pending when an invalid decision is rejected', () => {
    const queue = createApprovalQueue();
    queue.request('Read', '{}');
    const id = queue.pending()[0].id;
    try {
      queue.resolve(id, 'maybe' as unknown as 'allow');
    } catch {
      /* expected */
    }
    expect(queue.pending().map((p) => p.id)).toEqual([id]);
  });

  it('is a no-op for unknown ids', () => {
    const queue = createApprovalQueue();
    expect(() => queue.resolve('does-not-exist', 'allow')).not.toThrow();
  });
});

describe('assertApprovalDecision', () => {
  it('passes valid values through', () => {
    expect(assertApprovalDecision('allow')).toBe('allow');
    expect(assertApprovalDecision('deny')).toBe('deny');
  });

  it('rejects non-string and non-canonical values', () => {
    expect(() => assertApprovalDecision('Allow')).toThrow();
    expect(() => assertApprovalDecision('')).toThrow();
    expect(() => assertApprovalDecision(undefined)).toThrow();
    expect(() => assertApprovalDecision(null)).toThrow();
    expect(() => assertApprovalDecision(1)).toThrow();
  });
});
