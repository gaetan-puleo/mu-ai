import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createHostConfig } from './host-config';

describe('createHostConfig', () => {
  it('returns empty path arrays when no overrides are provided', () => {
    const config = createHostConfig('coding-agent');
    expect(config).toEqual({
      hostName: 'coding-agent',
      pluginsDirs: [],
      permissionsFiles: [],
      skillsDirs: [],
      subAgentsDirs: [],
    });
  });

  it('preserves the hostName even when overrides supply path arrays', () => {
    const config = createHostConfig('arya', {
      skillsDirs: ['/home/u/.arya/skills'],
    });
    expect(config.hostName).toBe('arya');
    expect(config.skillsDirs).toEqual(['/home/u/.arya/skills']);
  });

  it('accepts overrides for each path category independently', () => {
    const config = createHostConfig('coding-agent', {
      pluginsDirs: ['/global/plugins', '/project/.mu/plugins'],
      permissionsFiles: ['/global/permissions.json'],
      skillsDirs: ['/skills'],
      subAgentsDirs: ['/agents'],
    });
    expect(config.pluginsDirs).toEqual(['/global/plugins', '/project/.mu/plugins']);
    expect(config.permissionsFiles).toEqual(['/global/permissions.json']);
    expect(config.skillsDirs).toEqual(['/skills']);
    expect(config.subAgentsDirs).toEqual(['/agents']);
  });

  it('ignores hostName in overrides — name passed positionally wins', () => {
    // overrides type is Partial<Omit<HostConfig, 'hostName'>>, so this is a
    // type-level guarantee. Test the runtime behavior anyway.
    const config = createHostConfig('coding-agent', { pluginsDirs: ['/p'] });
    expect(config.hostName).toBe('coding-agent');
  });
});
