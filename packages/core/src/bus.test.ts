import { createBus } from './bus';

describe('EventBus', () => {
  it('should publish events to subscribers', () => {
    const bus = createBus<{ type: string; value: number }>();
    const received: { type: string; value: number }[] = [];

    bus.subscribe((event) => received.push(event));

    bus.publish({ type: 'test', value: 42 });

    expect(received).toEqual([{ type: 'test', value: 42 }]);
  });

  it('should support multiple subscribers', () => {
    const bus = createBus<{ type: string }>();
    const received1: { type: string }[] = [];
    const received2: { type: string }[] = [];

    bus.subscribe((event) => received1.push(event));
    bus.subscribe((event) => received2.push(event));

    bus.publish({ type: 'hello' });

    expect(received1).toEqual([{ type: 'hello' }]);
    expect(received2).toEqual([{ type: 'hello' }]);
  });

  it('should unsubscribe correctly', () => {
    const bus = createBus<{ type: string }>();
    const received: { type: string }[] = [];

    const unsubscribe = bus.subscribe((event) => received.push(event));

    bus.publish({ type: 'first' });
    unsubscribe();
    bus.publish({ type: 'second' });

    expect(received).toEqual([{ type: 'first' }]);
  });

  it('should handle no subscribers', () => {
    const bus = createBus<{ type: string }>();

    expect(() => bus.publish({ type: 'test' })).not.toThrow();
  });
});
