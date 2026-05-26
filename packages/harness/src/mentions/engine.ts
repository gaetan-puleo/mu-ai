import type { ExpandResult, MentionResolver, ResolvedMention } from './types';

/**
 * `@prefix:target` — prefix must start with a letter/underscore, target is
 * any run of non-whitespace, non-comma chars. Slashes/dots/dashes allowed
 * in the target so `@file:./src/foo.ts` works.
 *
 * Mentions inside fenced code blocks (```…```), inline code (`…`) or preceded
 * by a backslash are skipped — see `findCodeRegions` and the escape handling
 * in `expand`. This keeps stray `@user` strings in quoted logs/code from
 * triggering live resolvers.
 */
const MENTION_REGEX = /@([a-zA-Z_][\w-]*):([^\s,]+)/g;

/** Fenced (```…```) and inline (`…`) code spans we should NOT expand inside. */
const CODE_REGION_REGEX = /```[\s\S]*?```|`[^`\n]*`/g;

export interface MentionEngine {
  register(resolver: MentionResolver): void;
  unregister(prefix: string): void;
  list(): MentionResolver[];
  get(prefix: string): MentionResolver | undefined;
  expand(text: string, ctx?: Record<string, unknown>): Promise<ExpandResult>;
}

export function createMentionEngine(): MentionEngine {
  const resolvers = new Map<string, MentionResolver>();

  return {
    register(resolver) {
      if (resolvers.has(resolver.prefix)) {
        throw new Error(`Mention resolver for "@${resolver.prefix}" is already registered`);
      }
      resolvers.set(resolver.prefix, resolver);
    },

    unregister(prefix) {
      resolvers.delete(prefix);
    },

    list() {
      return [...resolvers.values()];
    },

    get(prefix) {
      return resolvers.get(prefix);
    },

    async expand(text, ctx = {}) {
      const mentions: ResolvedMention[] = [];
      const codeRegions = findCodeRegions(text);
      const matches = [...text.matchAll(MENTION_REGEX)];

      type Candidate = {
        raw: string;
        prefix: string;
        target: string;
        index: number;
        /** Length of the source span we'll replace (raw, plus leading `\` when escaped). */
        spanLength: number;
        /** Forced replacement when escaped (raw without the backslash). */
        forcedReplacement?: string;
      };

      const candidates: Candidate[] = [];
      for (const match of matches) {
        const [raw, prefix, target] = match;
        const index = match.index ?? 0;
        if (inAnyRegion(index, codeRegions)) continue;
        const escaped = index > 0 && text[index - 1] === '\\';
        if (escaped) {
          // Strip the backslash but do NOT resolve.
          candidates.push({
            raw,
            prefix,
            target,
            index: index - 1,
            spanLength: raw.length + 1,
            forcedReplacement: raw,
          });
          continue;
        }
        candidates.push({ raw, prefix, target, index, spanLength: raw.length });
      }

      // Resolve in parallel — order is preserved by the candidate array.
      const resolved = await Promise.all(
        candidates.map(async (c) => {
          if (c.forcedReplacement !== undefined) {
            return { ...c, display: c.forcedReplacement, result: undefined };
          }
          const resolver = resolvers.get(c.prefix);
          if (!resolver) return undefined;
          const result = await resolver.resolve(c.target, ctx);
          return { ...c, display: result.display, result };
        }),
      );

      const handled = resolved.filter((r): r is NonNullable<typeof r> => r !== undefined);

      // Apply replacements right-to-left so earlier indices stay valid.
      let out = text;
      for (const m of [...handled].reverse()) {
        if (m.display !== undefined) {
          out = out.slice(0, m.index) + m.display + out.slice(m.index + m.spanLength);
        }
      }

      for (const m of handled) {
        if (m.result) {
          mentions.push({ raw: m.raw, prefix: m.prefix, target: m.target, result: m.result });
        }
      }

      return { text: out, mentions };
    },
  };
}

interface Region {
  start: number;
  end: number;
}

/** Return the [start, end) spans of every fenced or inline code region. */
function findCodeRegions(text: string): Region[] {
  const regions: Region[] = [];
  for (const m of text.matchAll(CODE_REGION_REGEX)) {
    const start = m.index ?? 0;
    regions.push({ start, end: start + m[0].length });
  }
  return regions;
}

function inAnyRegion(index: number, regions: Region[]): boolean {
  for (const r of regions) {
    if (index >= r.start && index < r.end) return true;
  }
  return false;
}
