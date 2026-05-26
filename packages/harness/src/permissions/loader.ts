import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parse as parseYaml } from '@std/yaml';
import type { PermissionConfig, PermissionDecision, PermissionRule } from './types';

const VALID_DECISIONS: PermissionDecision[] = ['allow', 'deny', 'ask'];

/**
 * Read every file in `permissionsFiles` (in order) and merge them into a
 * single PermissionConfig. Later files extend rules and overwrite the default.
 * Missing files are skipped silently; malformed files throw.
 *
 * Files ending in `.yaml` / `.yml` are parsed as YAML; everything else as JSON.
 */
export function loadPermissions(permissionsFiles: string[]): PermissionConfig {
  const merged: PermissionConfig = { rules: [], default: 'ask' };

  for (const path of permissionsFiles) {
    if (!existsSync(path)) continue;
    const parsed = parseFile(path);
    merged.rules.push(...parsed.rules);
    if (parsed.default !== undefined) merged.default = parsed.default;
  }

  return merged;
}

interface ParsedFile {
  rules: PermissionRule[];
  default?: PermissionDecision;
}

function parseFile(path: string): ParsedFile {
  const text = readFileSync(path, 'utf-8');
  const ext = extname(path).toLowerCase();
  let raw: unknown;
  try {
    raw = ext === '.yaml' || ext === '.yml' ? parseYaml(text) : JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Permissions file ${path}: failed to parse (${msg})`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Permissions file ${path}: expected an object`);
  }
  const obj = raw as Record<string, unknown>;
  return {
    rules: parseRules(obj.rules, path),
    default: parseDecision(obj.default, `${path} (default)`),
  };
}

function parseRules(value: unknown, source: string): PermissionRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Permissions file ${source}: "rules" must be an array`);
  return value.map((r, i) => parseRule(r, `${source}#rules[${i}]`));
}

function parseRule(value: unknown, source: string): PermissionRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source}: expected an object`);
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.tool !== 'string' || obj.tool.length === 0) {
    throw new Error(`${source}: "tool" must be a non-empty string`);
  }
  if (obj.argsPattern !== undefined && typeof obj.argsPattern !== 'string') {
    throw new Error(`${source}: "argsPattern" must be a string when present`);
  }
  const decision = parseDecision(obj.decision, source);
  if (decision === undefined) {
    throw new Error(`${source}: "decision" is required`);
  }
  return {
    tool: obj.tool,
    argsPattern: obj.argsPattern as string | undefined,
    decision,
  };
}

function parseDecision(value: unknown, source: string): PermissionDecision | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !VALID_DECISIONS.includes(value as PermissionDecision)) {
    throw new Error(`${source}: must be one of ${VALID_DECISIONS.join(', ')}`);
  }
  return value as PermissionDecision;
}
