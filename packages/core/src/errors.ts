/** The bare message of an unknown thrown value — the single replacement for the
 * `e instanceof Error ? e.message : String(e)` idiom, repeated everywhere. */
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
