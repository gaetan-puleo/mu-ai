const TITLE_MAX_CHARS = 60;

/** Derive a session title from the first user message text. */
export function deriveTitleFromText(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Untitled session';
  return trimmed.length > TITLE_MAX_CHARS ? `${trimmed.slice(0, TITLE_MAX_CHARS - 1)}…` : trimmed;
}
