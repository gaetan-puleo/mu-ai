import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createDeferredCommandQueue } from './deferred-queue';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createDeferredCommandQueue', () => {
  it('runs entries in order on drain', async () => {
    let busy = true;
    const ran: string[] = [];
    const queue = createDeferredCommandQueue<string>({
      canDrain: () => !busy,
      runEntry: (entry) => ran.push(entry),
    });
    queue.push('a');
    queue.push('b');
    busy = false;
    queue.scheduleDrain();
    await tick();
    expect(ran).toEqual(['a', 'b']);
    expect(queue.size()).toBe(0);
  });

  it('does not drain while busy', async () => {
    let busy = true;
    const ran: string[] = [];
    const queue = createDeferredCommandQueue<string>({
      canDrain: () => !busy,
      runEntry: (entry) => ran.push(entry),
    });
    queue.push('a');
    queue.scheduleDrain();
    await tick();
    expect(ran).toEqual([]);
    expect(queue.size()).toBe(1);
    busy = false;
    queue.scheduleDrain();
    await tick();
    expect(ran).toEqual(['a']);
  });

  it('notifies onChange on push and drain', async () => {
    let changes = 0;
    const queue = createDeferredCommandQueue<string>({
      canDrain: () => true,
      runEntry: () => {},
      onChange: () => changes++,
    });
    queue.push('a');
    expect(changes).toBe(1);
    queue.scheduleDrain();
    await tick();
    expect(changes).toBe(2);
  });

  it('coalesces multiple scheduleDrain calls into one tick', async () => {
    let drains = 0;
    const queue = createDeferredCommandQueue<string>({
      canDrain: () => true,
      runEntry: () => drains++,
    });
    queue.push('a');
    queue.push('b');
    queue.scheduleDrain();
    queue.scheduleDrain();
    queue.scheduleDrain();
    await tick();
    expect(drains).toBe(2);
  });

  it('swallows per-entry errors', async () => {
    const queue = createDeferredCommandQueue<string>({
      canDrain: () => true,
      runEntry: (entry) => {
        if (entry === 'bad') throw new Error('boom');
      },
    });
    queue.push('good');
    queue.push('bad');
    queue.push('also-good');
    queue.scheduleDrain();
    await tick();
    expect(queue.size()).toBe(0);
  });

  it('clear empties without running', () => {
    let ran = 0;
    const queue = createDeferredCommandQueue<string>({
      canDrain: () => true,
      runEntry: () => ran++,
    });
    queue.push('a');
    queue.clear();
    expect(queue.size()).toBe(0);
    expect(ran).toBe(0);
  });
});
