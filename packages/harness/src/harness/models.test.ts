import { assertEquals } from '@std/assert';
import type { ModelModalities, Provider } from 'mu-core';
import { createModelRegistry } from './models';

const noopStream: Provider['stream'] = async function* () {};

Deno.test('models.capabilities delegates to the resolved provider (model name without provider prefix)', async () => {
  let seen = '';
  const vision: Provider = {
    stream: noopStream,
    capabilities: (model) => {
      seen = model;
      return Promise.resolve({ vision: true, audio: false } as ModelModalities);
    },
  };
  const registry = createModelRegistry({ providers: { local: vision }, default: 'local/gemma' });

  assertEquals(await registry.capabilities('local/gemma'), { vision: true, audio: false });
  assertEquals(seen, 'gemma'); // provider receives the bare model, not "local/gemma"
  assertEquals(await registry.capabilities(), { vision: true, audio: false }); // defaults to selected
});

Deno.test('models.capabilities is undefined for providers that cannot introspect', async () => {
  const plain: Provider = { stream: noopStream };
  const registry = createModelRegistry({ providers: { local: plain }, default: 'local/m' });
  assertEquals(await registry.capabilities('local/m'), undefined);
});
