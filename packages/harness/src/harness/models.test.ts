import { expect, test } from 'vitest';
import type { ModelModalities, Provider } from 'mu-core';
import { createModelRegistry } from './models';

const noopStream: Provider['stream'] = async function* () {};

test('models.capabilities delegates to the resolved provider (model name without provider prefix)', async () => {
  let seen = '';
  const vision: Provider = {
    stream: noopStream,
    capabilities: (model) => {
      seen = model;
      return Promise.resolve({ vision: true, audio: false } as ModelModalities);
    },
  };
  const registry = createModelRegistry({ providers: { local: vision }, default: 'local/gemma' });

  expect(await registry.capabilities('local/gemma')).toEqual({ vision: true, audio: false });
  expect(seen).toEqual('gemma'); // provider receives the bare model, not "local/gemma"
  expect(await registry.capabilities()).toEqual({ vision: true, audio: false }); // defaults to selected
});

test('models.capabilities is undefined for providers that cannot introspect', async () => {
  const plain: Provider = { stream: noopStream };
  const registry = createModelRegistry({ providers: { local: plain }, default: 'local/m' });
  expect(await registry.capabilities('local/m')).toEqual(undefined);
});
