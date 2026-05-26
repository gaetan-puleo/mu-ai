/**
 * Scoped logger. Minimal: text prefix, env-driven level.
 *
 * Levels: debug | info | warn | error. Drive level via an env var; default
 * is `MU_LOG_LEVEL` but hosts can pass their own (e.g. `ARYA_LOG_LEVEL`).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(subScope: string): Logger;
}

export interface CreateLoggerOptions {
  /** Env var to read the minimum level from. Defaults to `MU_LOG_LEVEL`. */
  levelEnvVar?: string;
  /** Default level when the env var is unset/invalid. Defaults to `info`. */
  defaultLevel?: LogLevel;
}

function readLevel(envVar: string, fallback: LogLevel): LogLevel {
  const raw = process.env[envVar]?.toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return fallback;
}

export function createLogger(scope: string, options: CreateLoggerOptions = {}): Logger {
  const envVar = options.levelEnvVar ?? 'MU_LOG_LEVEL';
  const fallback = options.defaultLevel ?? 'info';
  const minRank = LEVELS[readLevel(envVar, fallback)];

  function emit(level: LogLevel, args: unknown[]): void {
    if (LEVELS[level] < minRank) return;
    const sink = level === 'warn' || level === 'error' ? console.error : console.log;
    sink(`[${scope}]`, ...args);
  }

  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    child: (subScope) => createLogger(`${scope}:${subScope}`, options),
  };
}
