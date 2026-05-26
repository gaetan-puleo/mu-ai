import type { ExpandResult, MentionResolver, ResolvedMention } from './types';

/**
 * `@prefix:target` — prefix must start with a letter/underscore, target is
 * any run of non-whitespace, non-comma chars. Slashes/dots/dashes allowed
 * in the target so `@file:./src/foo.ts` works.
 */
const MENTION_REGEX = /@([a-zA-Z_][\w-]*):([^\s,]+)/g;

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
      const matches = [...text.matchAll(MENTION_REGEX)];

      // Resolve in parallel — order is preserved by the original match array.
      const resolved = await Promise.all(
        matches.map(async (match) => {
          const [raw, prefix, target] = match;
          const resolver = resolvers.get(prefix);
          if (!resolver) return undefined;
          const result = await resolver.resolve(target, ctx);
          return { raw, prefix, target, result, index: match.index ?? 0 } satisfies ResolvedMention & { index: number };
        }),
      );

      // Apply replacements right-to-left so earlier indices stay valid.
      let out = text;
      const handled = resolved.filter((r): r is NonNullable<typeof r> => r !== undefined);
      for (const m of [...handled].reverse()) {
        if (m.result.display !== undefined) {
          out = out.slice(0, m.index) + m.result.display + out.slice(m.index + m.raw.length);
        }
      }

      for (const m of handled) {
        mentions.push({ raw: m.raw, prefix: m.prefix, target: m.target, result: m.result });
      }

      return { text: out, mentions };
    },
  };
}
