// Agent Skills (agentskills.io) validation — the format contract.
//
// A skill is a directory holding a `SKILL.md`: YAML frontmatter + Markdown body.
// Required: `name` (lowercase slug, matches the directory), `description`.
// Optional: `license`, `compatibility` (≤500), `metadata` (string→string),
// `allowed-tools` (space-separated, experimental).
//
// This is the single source of truth for "a valid skill" across mu and arya.
// The parser (parser.ts) produces a Skill; these functions check it against the
// spec. The loader (loader.ts) pairs them to report per-skill issues.

import type { Skill } from './types';

export interface SkillIssue {
  field: string;
  message: string;
}

export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
export const COMPATIBILITY_MAX = 500;

export function validateName(name: unknown): SkillIssue[] {
  if (typeof name !== 'string' || name.length === 0) return [{ field: 'name', message: 'name is required' }];
  const issues: SkillIssue[] = [];
  if (name.length > NAME_MAX) issues.push({ field: 'name', message: `name must be at most ${NAME_MAX} characters` });
  if (/[A-Z]/.test(name)) issues.push({ field: 'name', message: 'name must be lowercase (a-z, 0-9, hyphens)' });
  if (name.startsWith('-')) issues.push({ field: 'name', message: 'name must not start with a hyphen' });
  if (name.endsWith('-')) issues.push({ field: 'name', message: 'name must not end with a hyphen' });
  if (name.includes('--')) issues.push({ field: 'name', message: 'name must not contain consecutive hyphens' });
  if (/[^a-z0-9-]/.test(name)) issues.push({ field: 'name', message: 'name may only contain lowercase letters, digits, and hyphens' });
  return issues;
}

export function validateDescription(desc: unknown): SkillIssue[] {
  if (typeof desc !== 'string' || desc.trim().length === 0) {
    return [{ field: 'description', message: 'description is required and must be non-empty' }];
  }
  if (desc.length > DESCRIPTION_MAX) {
    return [{ field: 'description', message: `description must be at most ${DESCRIPTION_MAX} characters` }];
  }
  return [];
}

/** Validate a parsed skill against the agentskills.io rules. `dirName`, when
 * given, enforces that `name` matches the parent directory name. */
export function validateSkill(skill: Skill, dirName?: string): SkillIssue[] {
  const issues: SkillIssue[] = [...validateName(skill.name), ...validateDescription(skill.description)];
  if (skill.compatibility !== undefined && skill.compatibility.length > COMPATIBILITY_MAX) {
    issues.push({ field: 'compatibility', message: `compatibility must be at most ${COMPATIBILITY_MAX} characters` });
  }
  if (dirName && skill.name && skill.name !== dirName) {
    issues.push({ field: 'name', message: `name "${skill.name}" must match the parent directory name "${dirName}"` });
  }
  return issues;
}
