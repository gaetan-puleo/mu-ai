import { parseFrontmatter, str, strList } from '../common';
import type { Skill } from './types';

/** Coerce a frontmatter `metadata` map to string→string (numbers/booleans stringified). */
const parseMetadata = (raw: unknown): Record<string, string> | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
};

export const parseSkill = (source: string, fallbackName: string, dir?: string): Skill => {
  const { fields, body } = parseFrontmatter(source);

  const platforms = strList(fields.platforms);
  const skill: Skill = {
    name: str(fields.name) ?? fallbackName,
    description: str(fields.description) ?? '',
    prompt: body,
  };
  // Emit optional keys only when present — strict-equality tests rely on no `undefined`-valued keys.
  if (dir !== undefined) skill.dir = dir;
  if (platforms.length) skill.platforms = platforms;
  const command = str(fields.command);
  if (command) skill.command = command;
  const license = str(fields.license);
  if (license !== undefined) skill.license = license;
  const compatibility = str(fields.compatibility);
  if (compatibility !== undefined) skill.compatibility = compatibility;
  const allowedTools = str(fields['allowed-tools']);
  if (allowedTools !== undefined) skill.allowedTools = allowedTools;
  const metadata = parseMetadata(fields.metadata);
  if (metadata !== undefined) skill.metadata = metadata;
  return skill;
};
