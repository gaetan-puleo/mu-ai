import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import type { LLMProvider, Plugin } from 'mu-core';
import { pickProviderPlugin } from './provider-selection';

// deno-lint-ignore no-explicit-any
const stubProvider: LLMProvider = (async () => ({}) as any) as LLMProvider;

const withProvider = (name: string): Plugin => ({ name, provider: stubProvider });
const withoutProvider = (name: string): Plugin => ({ name });

describe('pickProviderPlugin', () => {
  it('prepends the fallback when no plugin supplies a provider', () => {
    const fallback = withProvider('local');
    const plugins: Plugin[] = [withoutProvider('webfetch')];
    const result = pickProviderPlugin({ plugins, fallback });
    expect(result.usingFallback).toBe(true);
    expect(plugins[0]).toBe(fallback);
    expect(result.plugin).toBe(fallback);
  });

  it('uses a user-supplied provider plugin without touching the array', () => {
    const userProvider = withProvider('user-provider');
    const fallback = withProvider('local');
    const plugins: Plugin[] = [withoutProvider('webfetch'), userProvider];
    const result = pickProviderPlugin({ plugins, fallback });
    expect(result.usingFallback).toBe(false);
    expect(result.plugin).toBe(userProvider);
    expect(plugins.includes(fallback)).toBe(false);
  });

  it('honors requestedName when the plugin exists', () => {
    const named = withProvider('chosen');
    const fallback = withProvider('local');
    const plugins: Plugin[] = [withProvider('other'), named];
    const result = pickProviderPlugin({ plugins, requestedName: 'chosen', fallback });
    expect(result.usingFallback).toBe(false);
    expect(result.plugin).toBe(named);
    expect(plugins.includes(fallback)).toBe(false);
  });

  it('throws when requestedName is missing', () => {
    const fallback = withProvider('local');
    const plugins: Plugin[] = [withProvider('other')];
    expect(() => pickProviderPlugin({ plugins, requestedName: 'missing', fallback }))
      .toThrow(/Provider plugin "missing"/);
  });

  it('throws when requestedName exists but lacks a provider', () => {
    const fallback = withProvider('local');
    const plugins: Plugin[] = [withoutProvider('inert')];
    expect(() => pickProviderPlugin({ plugins, requestedName: 'inert', fallback }))
      .toThrow(/does not export a provider/);
  });
});
