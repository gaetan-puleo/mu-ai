/**
 * Shared option shape for every fs-rooted tool factory. Per-tool factories
 * extend this when they need extra knobs (bash adds a max-output cap, an
 * abort fallback, etc.).
 *
 * `getCwd` is a getter rather than a static string so the host can swap the
 * working directory per session without rebuilding the tool map.
 */
export interface ToolFactoryOptions {
  getCwd: () => string;
}
