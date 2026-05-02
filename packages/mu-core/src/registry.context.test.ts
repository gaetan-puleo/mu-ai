import { describe, expect, it } from 'bun:test';
import type { AgentSourceRegistry, Plugin } from './plugin';
import { PluginRegistry } from './registry';

describe('PluginRegistry context propagation', () => {
  it('setAgentsRegistry from one plugin reaches subsequent plugins', async () => {
    const reg = new PluginRegistry({ cwd: '/tmp', config: {} });
    const calls: Array<{ name: string; sawAgents: boolean }> = [];

    const publisher: Plugin = {
      name: 'publisher',
      activate(ctx) {
        const sourceReg: AgentSourceRegistry = {
          registerSource: () =>
            function unregister(): void {
              /* noop */
            },
        };
        ctx.setAgentsRegistry?.(sourceReg);
        calls.push({ name: 'publisher', sawAgents: !!ctx.agents });
      },
    };

    const consumer: Plugin = {
      name: 'consumer',
      activate(ctx) {
        calls.push({ name: 'consumer', sawAgents: !!ctx.agents });
        ctx.agents?.registerSource('/some/dir');
      },
    };

    await reg.register(publisher);
    await reg.register(consumer);

    expect(calls.find((c) => c.name === 'consumer')?.sawAgents).toBe(true);
  });

  it('plugins activated before publisher do not see agents', async () => {
    const reg = new PluginRegistry({ cwd: '/tmp', config: {} });
    let earlySaw = false;
    let lateSaw = false;
    const early: Plugin = {
      name: 'early',
      activate(ctx) {
        earlySaw = !!ctx.agents;
      },
    };
    const publisher: Plugin = {
      name: 'pub',
      activate(ctx) {
        ctx.setAgentsRegistry?.({
          registerSource: () =>
            function unregister(): void {
              /* noop */
            },
        });
      },
    };
    const late: Plugin = {
      name: 'late',
      activate(ctx) {
        lateSaw = !!ctx.agents;
      },
    };
    await reg.register(early);
    await reg.register(publisher);
    await reg.register(late);
    expect(earlySaw).toBe(false);
    expect(lateSaw).toBe(true);
  });
});
