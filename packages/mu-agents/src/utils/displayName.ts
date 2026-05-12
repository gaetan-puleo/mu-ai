/**
 * Format an agent id for display.
 *
 * Today: title-case the first letter. mu-coding's TUI and arya's
 * companion both did this inline; centralising here means future
 * channels render the same way.
 */

export function capitalizeAgentName(id: string): string {
  if (!id) return id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}
