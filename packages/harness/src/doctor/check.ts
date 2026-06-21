/** Generic health-check primitives. Product-agnostic: a host composes a list of
 * {@link Check}s, runs them with {@link runChecks}, and renders the report however
 * it likes (terminal, JSON, …). Levels are intentionally coarse so any host can
 * map them to its own UI without knowing the check internals. */
export type CheckLevel = 'ok' | 'warn' | 'fail' | 'info';

export interface CheckResult {
  level: CheckLevel;
  title: string;
  detail?: string;
}

const make = (level: CheckLevel) => (title: string, detail?: string): CheckResult => ({ level, title, detail });

export const ok = make('ok');
export const warn = make('warn');
export const fail = make('fail');
export const info = make('info');

export interface DoctorReport {
  results: CheckResult[];
  /** True iff no result has level 'fail' — warn/info are non-blocking. */
  ok: boolean;
}

/** A check may be sync or async and may emit one or several results (e.g. a probe
 * that reports both a port and the service behind it). */
export type Check = () => CheckResult | CheckResult[] | Promise<CheckResult | CheckResult[]>;

/** Run every check, flattening multi-result checks. A throwing check becomes a
 * `fail` result rather than aborting the whole run, so one broken probe never
 * hides the rest of the diagnosis. */
export async function runChecks(checks: Check[]): Promise<DoctorReport> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      const out = await check();
      if (Array.isArray(out)) results.push(...out);
      else results.push(out);
    } catch (err) {
      results.push(fail('check threw', err instanceof Error ? err.message : String(err)));
    }
  }
  return { results, ok: !results.some((r) => r.level === 'fail') };
}

const SYMBOLS: Record<CheckLevel, string> = { ok: '✓', warn: '⚠', fail: '✗', info: '→' };

/** Plain-text render (no ANSI) so it is safe for logs, pipes, and tests. Hosts
 * that want color can build their own renderer over {@link DoctorReport}. */
export function formatReport(report: DoctorReport): string {
  return report.results
    .map((r) => `${SYMBOLS[r.level]} ${r.title}${r.detail ? ` — ${r.detail}` : ''}`)
    .join('\n');
}
