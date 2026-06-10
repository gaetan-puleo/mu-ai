import { assertEquals, assertStringIncludes } from '@std/assert';
import { environmentBlock } from './environment';

Deno.test('environmentBlock lists the config, plugins, skills and sub-agents directories', () => {
  const block = environmentBlock({
    os: 'linux 6.17.0 (x64)',
    configDir: '/c',
    pluginsDir: '/c/plugins',
    skillsDir: '/c/skills',
    agentsDir: '/c/agents',
  });

  assertEquals(block.startsWith('<env>\n'), true);
  assertEquals(block.endsWith('\n</env>'), true);
  assertStringIncludes(block, 'Operating system: linux 6.17.0 (x64)');
  assertStringIncludes(block, 'Config directory: /c');
  assertStringIncludes(block, 'Plugins directory: /c/plugins');
  assertStringIncludes(block, 'Skills directory: /c/skills');
  assertStringIncludes(block, 'Sub-agents directory: /c/agents');
  assertStringIncludes(block, 'source code: https://github.com/gaetan-puleo/mu-ai');
});
