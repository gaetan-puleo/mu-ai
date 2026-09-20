// mu-coding — the mu product package.
//
// Public surface = the in-process SDK (what arya imports) + the product defaults
// (named exports a host may reuse or override). The CLI itself lives in `bin/` and
// is NOT part of this surface: a library consumer never touches the bin.
export * from './harness';

// Product defaults — available as named exports; arya does not pull these.
export { runApp, type RunAppOptions } from './main';
export { BASE_SYSTEM_PROMPT } from './systemPrompt';
export { isReadOnlyBash } from './bash-safety';
export { builtinAgents } from './agents';
export { builtinSkills } from './skills';
export { loadPlugins, installPlugin, uninstallPlugin } from './plugins';
