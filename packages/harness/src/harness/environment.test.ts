import { assertEquals, assertStringIncludes } from '@std/assert';
import { environmentBlock } from './environment';

Deno.test('environmentBlock lists the config, plugins, skills and sub-agents directories', () => {
  const block = environmentBlock({
    configDir: '/c',
    pluginsDir: '/c/plugins',
    skillsDir: '/c/skills',
    agentsDir: '/c/agents',
  });

  assertEquals(block.startsWith('<env>\n'), true);
  assertEquals(block.endsWith('\n</env>'), true);
  assertStringIncludes(block, 'Config directory: /c');
  assertStringIncludes(block, 'Plugins directory: /c/plugins');
  assertStringIncludes(block, 'Skills directory: /c/skills');
  assertStringIncludes(block, 'Sub-agents directory: /c/agents');
});
