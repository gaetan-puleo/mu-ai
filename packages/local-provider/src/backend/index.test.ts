import { assertEquals } from '@std/assert';
import { detectBackend } from './index';
import { llamaCppModalities } from './llama-cpp';
import { llamaSwapModalities } from './llama-swap';

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const notFound = (): Response => new Response('not found', { status: 404 });

const withFetch = async (impl: (url: string) => Response, run: () => Promise<void>): Promise<void> => {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => Promise.resolve(impl(url.toString()))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

Deno.test('detectBackend recognizes a llama-server (llama-cpp)', async () => {
  const fetchImpl = (url: string): Response => {
    if (url.endsWith('/v1/models')) return json({ data: [{ id: 'qwen', owned_by: 'llamacpp' }] });
    if (url.endsWith('/props')) {
      return json({ default_generation_settings: { n_ctx: 4096 }, model_path: '/m/qwen.gguf', total_slots: 1 });
    }
    if (url.endsWith('/slots')) return json([{ id: 0, is_processing: false }]);
    return notFound();
  };
  await withFetch(fetchImpl, async () => {
    const found = await detectBackend({ baseUrl: 'http://localhost:8080' });
    assertEquals(found?.info.kind, 'llama-cpp');
    assertEquals(found?.info.models[0].id, 'qwen');
  });
});

Deno.test('detectBackend recognizes llama-swap with priority', async () => {
  const fetchImpl = (url: string): Response => {
    if (url.endsWith('/v1/models')) return json({ data: [{ id: 'qwen', owned_by: 'llama-swap' }] });
    return notFound();
  };
  await withFetch(fetchImpl, async () => {
    const found = await detectBackend({ baseUrl: 'http://localhost:8080' });
    assertEquals(found?.info.kind, 'llama-swap');
  });
});

Deno.test('detectBackend returns undefined if no backend', async () => {
  await withFetch(() => notFound(), async () => {
    assertEquals(await detectBackend({ baseUrl: 'http://localhost:8080' }), undefined);
  });
});

Deno.test('modalities are read from /props (llama-cpp + llama-swap)', async () => {
  const props = {
    default_generation_settings: { n_ctx: 4096 },
    total_slots: 1,
    model_path: '/m/gemma.gguf',
    model_alias: 'gemma',
    modalities: { vision: true, video: true, audio: false },
  };
  await withFetch((url) => (url.endsWith('/props') ? json(props) : notFound()), async () => {
    assertEquals(await llamaCppModalities({ baseUrl: 'http://localhost:8080' }), { vision: true, audio: false });
    assertEquals(
      await llamaSwapModalities({ baseUrl: 'http://localhost:8080', model: 'gemma' }),
      { vision: true, audio: false },
    );
  });
});

Deno.test('modalities undefined when /props omits the field (older llama.cpp)', async () => {
  const props = { default_generation_settings: { n_ctx: 4096 }, total_slots: 1, model_path: '/m/q.gguf', model_alias: 'q' };
  await withFetch((url) => (url.endsWith('/props') ? json(props) : notFound()), async () => {
    assertEquals(await llamaSwapModalities({ baseUrl: 'http://localhost:8080', model: 'q' }), undefined);
  });
});
