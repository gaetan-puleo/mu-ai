import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { parseAgentRouting } from './routing';

const build = { name: 'build' };
const plan = { name: 'plan' };
const reviewer = { name: 'reviewer' };

describe('parseAgentRouting', () => {
  it('returns none for a message with no @-prefix', () => {
    const result = parseAgentRouting('hello world', { primaryAgents: [build], subAgents: [reviewer] });
    expect(result.kind).toBe('none');
  });

  it('routes a known primary as override', () => {
    const result = parseAgentRouting('@plan refactor X', {
      primaryAgents: [build, plan],
      subAgents: [reviewer],
    });
    expect(result.kind).toBe('override');
    if (result.kind === 'override') expect(result.agent).toBe(plan);
  });

  it('routes a known sub-agent as dispatch and strips the prefix from the task', () => {
    const result = parseAgentRouting('@reviewer audit the diff', {
      primaryAgents: [build],
      subAgents: [reviewer],
    });
    expect(result.kind).toBe('dispatch');
    if (result.kind === 'dispatch') {
      expect(result.agent).toBe(reviewer);
      expect(result.task).toBe('audit the diff');
    }
  });

  it('falls back to the full text when only the prefix is present', () => {
    const result = parseAgentRouting('@reviewer', { subAgents: [reviewer] });
    expect(result.kind).toBe('dispatch');
    if (result.kind === 'dispatch') expect(result.task).toBe('@reviewer');
  });

  it('is case-insensitive on agent names', () => {
    const result = parseAgentRouting('@REVIEWER look at this', { subAgents: [reviewer] });
    expect(result.kind).toBe('dispatch');
  });

  it('returns none when the name matches nothing', () => {
    const result = parseAgentRouting('@ghost hello', {
      primaryAgents: [build],
      subAgents: [reviewer],
    });
    expect(result.kind).toBe('none');
  });
});
