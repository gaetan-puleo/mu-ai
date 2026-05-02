/**
 * mu-webfetch — fetches the contents of a URL and returns it as plain text,
 * with the <head>…</head> block stripped from HTML responses. Ported from
 * the pi-coding-agent plugin of the same name.
 */

import type { Plugin, PluginTool } from 'mu-core';

const WEBFETCH_SYSTEM_PROMPT = [
  '## Web Fetch Tool',
  '',
  '- **webfetch**: Fetch the content of a URL and return it as plain text.',
  '  - Use when: You need to fetch web pages, documentation, or any URL content',
  '  - Parameter: url (required) — the URL to fetch (http(s) only)',
  '',
  'Note: The <head> section is automatically stripped from HTML responses.',
].join('\n');

function createWebFetchTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'webfetch',
        description: 'Fetch the content of a given URL and return it as plain text, stripping the <head> section.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch (must be a valid HTTP or HTTPS URL).',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'fetching',
      kind: 'webfetch',
      fields: { path: 'url' },
    },
    permission: {
      // Lets agent definitions glob-allow URLs, e.g.
      //   webfetch: { allow: ["https://github.com/**", "https://*.dev/**"] }
      matchKey: (args) => (typeof args.url === 'string' ? args.url : undefined),
    },
    async execute(args, signal) {
      const url = args.url as string;
      try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          return {
            content: `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
            error: true,
          };
        }
        const text = await response.text();
        const stripped = text.replace(/<head[^>]*>[\s\S]*?<\/head>/i, '');
        return stripped;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error fetching ${url}: ${message}`, error: true };
      }
    },
  };
}

export function createWebFetchPlugin(): Plugin {
  return {
    name: 'mu-webfetch',
    version: '0.9.0',
    tools: [createWebFetchTool()],
    systemPrompt: WEBFETCH_SYSTEM_PROMPT,
  };
}

export default createWebFetchPlugin;
