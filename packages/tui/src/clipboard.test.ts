import { assertEquals } from '@std/assert';
import { readClipboardImage } from './clipboard';

Deno.test('readClipboardImage resolves to undefined (no throw) when no clipboard image / tool is present', async () => {
  // In CI / headless / no-image-in-clipboard environments this must degrade gracefully.
  const result = await readClipboardImage();
  assertEquals(result === undefined || (result.mime.startsWith('image/') && result.data.byteLength > 0), true);
});
