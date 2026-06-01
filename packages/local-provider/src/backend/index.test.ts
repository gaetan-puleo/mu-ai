import { assertEquals } from '@std/assert';
import { detectBackend } from './index';

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
