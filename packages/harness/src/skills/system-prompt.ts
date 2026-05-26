import type { Skill } from './types';

/**
 * Build the XML block listing every available skill, suitable for injection
 * into the system prompt. Returns an empty string when no skills are loaded
 * so callers can append it unconditionally.
 */
export function formatSkillsForSystemPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const entries = skills
    .map((s) => `  <skill name="${escapeAttr(s.name)}">${escapeText(s.description)}</skill>`)
    .join('\n');

  return `<available_skills>\n${entries}\n</available_skills>`;
}

/**
 * Wrap a single skill's body for injection when the agent invokes it.
 * The `name` and `filePath` are surfaced as attributes so a downstream
 * renderer can show context.
 */
export function formatSkillInvocation(skill: Skill, additionalInstructions?: string): string {
  const block =
    `<skill name="${escapeAttr(skill.name)}" location="${escapeAttr(skill.filePath)}">\n${skill.content}\n</skill>`;
  return additionalInstructions ? `${block}\n\n${additionalInstructions}` : block;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
