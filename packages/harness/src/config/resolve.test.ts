import { assertEquals } from '@std/assert';
import { createHarnessConfig } from './resolve';

Deno.test('createHarnessConfig namespaces each XDG base by hostName', () => {
  const config = createHarnessConfig({
    hostName: 'mu',
    xdg: {
      configHome: '/home/u/.config',
      dataHome: '/home/u/.local/share',
      stateHome: '/home/u/.local/state',
    },
  });

  assertEquals(config, {
    hostName: 'mu',
    configDir: '/home/u/.config/mu',
    dataDir: '/home/u/.local/share/mu',
    stateDir: '/home/u/.local/state/mu',
  });
});
