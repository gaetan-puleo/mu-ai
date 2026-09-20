import { expect, test } from 'vitest';
import { environmentBlock } from './environment';

test('environmentBlock lists the config, plugins, skills and sub-agents directories', () => {
  const block = environmentBlock({
    os: 'linux 6.17.0 (x64)',
    configDir: '/c',
    pluginsDir: '/c/plugins',
    skillsDir: '/c/skills',
    agentsDir: '/c/agents',
    hostName: 'arya',
    hostSourceUrl: 'https://github.com/gaetan-puleo/arya',
  });

  expect(block.startsWith('<env>\n')).toEqual(true);
  expect(block.endsWith('\n</env>')).toEqual(true);
  expect(block).toContain('Operating system: linux 6.17.0 (x64)');
  expect(block).toContain('Config directory: /c');
  expect(block).toContain('Plugins directory: /c/plugins');
  expect(block).toContain('Skills directory: /c/skills');
  expect(block).toContain('Sub-agents directory: /c/agents');
  expect(block).toContain('Harness (mu) source code: https://github.com/gaetan-puleo/mu-ai');
  expect(block).toContain('arya source code: https://github.com/gaetan-puleo/arya');
});

test('environmentBlock omits the host source line when no host URL is given', () => {
  const block = environmentBlock({
    os: 'linux',
    configDir: '/c',
    pluginsDir: '/c/plugins',
    skillsDir: '/c/skills',
    agentsDir: '/c/agents',
    hostName: 'mu',
  });

  expect(block.includes('mu source code:')).toEqual(false);
  expect(block).toContain('Harness (mu) source code:');
});
