import { Box, Text } from 'ink';
import React from 'react';
import { type BundledLanguage, bundledLanguages, createHighlighter, type HighlighterGeneric } from 'shiki';

type Block =
  | { kind: 'blank' }
  | { kind: 'code'; lang?: string; lines: string[] }
  | { kind: 'heading'; depth: number; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; marker: string; text: string }
  | { kind: 'paragraph'; text: string };

type InlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; label: string; url: string };

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const LIST_RE = /^(\s*)([-*+] |\d+\.\s+)(.+)$/;
const FENCE_RE = /^\s*```\s*([^`\s]+)?/;

export const CATPPUCCIN_MOCHA = {
  plain: '#cdd6f4',
  comment: '#6c7086',
  keyword: '#cba6f7',
  string: '#a6e3a1',
  number: '#fab387',
  function: '#89b4fa',
  type: '#f9e2af',
  operator: '#89dceb',
  property: '#f38ba8',
} as const;

export interface CodeSegment {
  text: string;
  color?: string;
  dimColor?: boolean;
}

type CodeLines = CodeSegment[][];
type CatppuccinHighlighter = HighlighterGeneric<BundledLanguage, 'catppuccin-mocha'>;

const SHIKI_ALIASES: Record<string, BundledLanguage> = {
  bash: 'bash',
  cjs: 'javascript',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  mjs: 'javascript',
  py: 'python',
  python: 'python',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

let highlighterPromise: Promise<CatppuccinHighlighter> | undefined;

function getHighlighter(): Promise<CatppuccinHighlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ['catppuccin-mocha'],
    langs: ['text'],
  });
  return highlighterPromise;
}

const JS_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'of',
  'return',
  'switch',
  'throw',
  'try',
  'type',
  'typeof',
  'var',
  'while',
]);

const JS_LITERALS = new Set(['false', 'null', 'true', 'undefined']);

const GENERIC_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'def',
  'defer',
  'do',
  'elif',
  'else',
  'end',
  'enum',
  'except',
  'export',
  'extends',
  'finally',
  'fn',
  'for',
  'from',
  'func',
  'function',
  'if',
  'impl',
  'import',
  'in',
  'interface',
  'let',
  'match',
  'module',
  'mut',
  'package',
  'private',
  'public',
  'return',
  'select',
  'struct',
  'switch',
  'then',
  'throw',
  'trait',
  'try',
  'type',
  'var',
  'while',
  'with',
  'yield',
]);

const GENERIC_LITERALS = new Set(['false', 'nil', 'none', 'null', 'true', 'undefined']);

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let inCode = false;
  let codeLines: string[] = [];
  let codeLang: string | undefined;

  for (const line of lines) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      if (inCode) {
        blocks.push({ kind: 'code', lang: codeLang, lines: codeLines });
        codeLines = [];
        codeLang = undefined;
        inCode = false;
      } else {
        codeLang = fence[1]?.toLowerCase();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      blocks.push({ kind: 'blank' });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', depth: heading[1]?.length ?? 1, text: stripInlineMarkdown(heading[2] ?? '') });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      blocks.push({ kind: 'quote', text: stripInlineMarkdown(quote[1] ?? '') });
      continue;
    }

    const list = LIST_RE.exec(line);
    if (list) {
      const marker = (list[2] ?? '- ').trim();
      blocks.push({ kind: 'list', marker, text: stripInlineMarkdown(list[3] ?? '') });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: line });
  }

  if (inCode) blocks.push({ kind: 'code', lang: codeLang, lines: codeLines });
  return blocks;
}

function normalizeLang(lang: string | undefined): 'js' | 'json' | 'shell' | 'generic' {
  if (!lang) return 'generic';
  if (['js', 'jsx', 'ts', 'tsx', 'typescript', 'javascript'].includes(lang)) return 'js';
  if (['json', 'jsonc'].includes(lang)) return 'json';
  if (['bash', 'sh', 'shell', 'zsh'].includes(lang)) return 'shell';
  return 'generic';
}

function pushSegment(
  segments: CodeSegment[],
  text: string,
  color: string = CATPPUCCIN_MOCHA.plain,
  dimColor = false,
): void {
  if (!text) return;
  const prev = segments[segments.length - 1];
  if (prev?.color === color && prev.dimColor === dimColor) {
    prev.text += text;
    return;
  }
  segments.push({ text, color, dimColor });
}

function readQuoted(line: string, start: number): number {
  const quote = line[start];
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2;
      continue;
    }
    if (line[i] === quote) return i + 1;
    i++;
  }
  return line.length;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: small scanner keeps syntax highlighting dependency-free.
function highlightJs(line: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith('//')) {
      pushSegment(segments, rest, CATPPUCCIN_MOCHA.comment, true);
      break;
    }
    if (rest.startsWith('/*')) {
      const end = line.indexOf('*/', i + 2);
      const next = end < 0 ? line.length : end + 2;
      pushSegment(segments, line.slice(i, next), CATPPUCCIN_MOCHA.comment, true);
      i = next;
      continue;
    }
    const ch = line[i] ?? '';
    if (ch === '"' || ch === "'" || ch === '`') {
      const next = readQuoted(line, i);
      pushSegment(segments, line.slice(i, next), CATPPUCCIN_MOCHA.string);
      i = next;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(rest);
    if (number) {
      pushSegment(segments, number[0], CATPPUCCIN_MOCHA.number);
      i += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (ident) {
      const word = ident[0];
      const after = line.slice(i + word.length).trimStart();
      const color = JS_KEYWORDS.has(word)
        ? CATPPUCCIN_MOCHA.keyword
        : JS_LITERALS.has(word)
          ? CATPPUCCIN_MOCHA.number
          : after.startsWith('(')
            ? CATPPUCCIN_MOCHA.function
            : /^[A-Z]/.test(word)
              ? CATPPUCCIN_MOCHA.type
              : CATPPUCCIN_MOCHA.plain;
      pushSegment(segments, word, color);
      i += word.length;
      continue;
    }
    if (/^[{}()[\].,;:<>!=+\-*/%|&?]/.test(ch)) {
      pushSegment(segments, ch, CATPPUCCIN_MOCHA.operator);
      i++;
      continue;
    }
    pushSegment(segments, ch);
    i++;
  }
  return segments;
}

function highlightJson(line: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i] ?? '';
    if (ch === '"') {
      const next = readQuoted(line, i);
      const after = line.slice(next).trimStart();
      pushSegment(
        segments,
        line.slice(i, next),
        after.startsWith(':') ? CATPPUCCIN_MOCHA.property : CATPPUCCIN_MOCHA.string,
      );
      i = next;
      continue;
    }
    const literal = /^(true|false|null)\b/.exec(rest);
    if (literal) {
      pushSegment(segments, literal[0], CATPPUCCIN_MOCHA.number);
      i += literal[0].length;
      continue;
    }
    const number = /^-?\d+(?:\.\d+)?/.exec(rest);
    if (number) {
      pushSegment(segments, number[0], CATPPUCCIN_MOCHA.number);
      i += number[0].length;
      continue;
    }
    if (/^[{}[\],:]/.test(ch)) {
      pushSegment(segments, ch, CATPPUCCIN_MOCHA.operator);
      i++;
      continue;
    }
    pushSegment(segments, ch);
    i++;
  }
  return segments;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: small scanner keeps syntax highlighting dependency-free.
function highlightShell(line: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  let i = 0;
  let sawCommand = false;
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i] ?? '';
    if (ch === '#') {
      pushSegment(segments, rest, CATPPUCCIN_MOCHA.comment, true);
      break;
    }
    if (ch === '"' || ch === "'") {
      const next = readQuoted(line, i);
      pushSegment(segments, line.slice(i, next), CATPPUCCIN_MOCHA.string);
      i = next;
      continue;
    }
    const variable = /^\$[A-Za-z_][\w]*/.exec(rest);
    if (variable) {
      pushSegment(segments, variable[0], CATPPUCCIN_MOCHA.number);
      i += variable[0].length;
      continue;
    }
    const flag = /^-{1,2}[A-Za-z0-9][\w-]*/.exec(rest);
    if (flag) {
      pushSegment(segments, flag[0], CATPPUCCIN_MOCHA.comment);
      i += flag[0].length;
      continue;
    }
    const word = /^[A-Za-z0-9_./:-]+/.exec(rest);
    if (word) {
      pushSegment(segments, word[0], sawCommand ? CATPPUCCIN_MOCHA.plain : CATPPUCCIN_MOCHA.function);
      sawCommand = true;
      i += word[0].length;
      continue;
    }
    if (/^[|&;<>()]/.test(ch)) {
      pushSegment(segments, ch, CATPPUCCIN_MOCHA.operator);
      if (ch === '|' || ch === ';' || ch === '&') sawCommand = false;
      i++;
      continue;
    }
    pushSegment(segments, ch);
    i++;
  }
  return segments;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: generic highlighter intentionally handles common syntax shapes.
function highlightGeneric(line: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith('//') || rest.startsWith('--')) {
      pushSegment(segments, rest, CATPPUCCIN_MOCHA.comment, true);
      break;
    }
    const ch = line[i] ?? '';
    if (ch === '#') {
      pushSegment(segments, rest, CATPPUCCIN_MOCHA.comment, true);
      break;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const next = readQuoted(line, i);
      pushSegment(segments, line.slice(i, next), CATPPUCCIN_MOCHA.string);
      i = next;
      continue;
    }
    const number = /^-?\d+(?:\.\d+)?/.exec(rest);
    if (number) {
      pushSegment(segments, number[0], CATPPUCCIN_MOCHA.number);
      i += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][\w-]*/.exec(rest);
    if (ident) {
      const word = ident[0];
      const after = line.slice(i + word.length).trimStart();
      const color = GENERIC_KEYWORDS.has(word)
        ? CATPPUCCIN_MOCHA.keyword
        : GENERIC_LITERALS.has(word.toLowerCase())
          ? CATPPUCCIN_MOCHA.number
          : after.startsWith('(')
            ? CATPPUCCIN_MOCHA.function
            : /^[A-Z]/.test(word)
              ? CATPPUCCIN_MOCHA.type
              : CATPPUCCIN_MOCHA.plain;
      pushSegment(segments, word, color);
      i += word.length;
      continue;
    }
    if (/^[{}()[\].,;:<>!=+\-*/%|&?]/.test(ch)) {
      pushSegment(segments, ch, CATPPUCCIN_MOCHA.operator);
      i++;
      continue;
    }
    pushSegment(segments, ch);
    i++;
  }
  return segments;
}

export function highlightCodeLine(line: string, lang?: string): CodeSegment[] {
  if (!line) return [{ text: ' ', color: CATPPUCCIN_MOCHA.plain }];
  const normalized = normalizeLang(lang);
  if (normalized === 'js') return highlightJs(line);
  if (normalized === 'json') return highlightJson(line);
  if (normalized === 'shell') return highlightShell(line);
  return highlightGeneric(line);
}

function fallbackHighlightCode(code: string, lang?: string): CodeLines {
  return code.split('\n').map((line) => highlightCodeLine(line, lang));
}

function resolveShikiLanguage(lang: string | undefined): BundledLanguage | undefined {
  if (!lang) return undefined;
  const normalized = lang.toLowerCase();
  const aliased = SHIKI_ALIASES[normalized];
  if (aliased) return aliased;
  return normalized in bundledLanguages ? (normalized as BundledLanguage) : undefined;
}

export async function highlightCode(code: string, lang?: string): Promise<CodeLines> {
  const shikiLang = resolveShikiLanguage(lang);
  if (!shikiLang) return fallbackHighlightCode(code, lang);

  try {
    const highlighter = await getHighlighter();
    if (!highlighter.getLoadedLanguages().includes(shikiLang)) {
      await highlighter.loadLanguage(shikiLang);
    }
    const result = highlighter.codeToTokens(code, {
      lang: shikiLang,
      theme: 'catppuccin-mocha',
    });
    return result.tokens.map((line) =>
      line.length > 0
        ? line.map((token) => ({
            text: token.content,
            color: token.color ?? CATPPUCCIN_MOCHA.plain,
            dimColor: false,
          }))
        : [{ text: ' ', color: CATPPUCCIN_MOCHA.plain, dimColor: false }],
    );
  } catch {
    return fallbackHighlightCode(code, lang);
  }
}

function useHighlightedCode(code: string, lang?: string): CodeLines {
  const [lines, setLines] = React.useState<CodeLines>(() => fallbackHighlightCode(code, lang));

  React.useEffect(() => {
    let cancelled = false;
    setLines(fallbackHighlightCode(code, lang));
    highlightCode(code, lang).then((next) => {
      if (!cancelled) setLines(next);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  return lines;
}

export function markdownToPlainText(markdown: string): string {
  const out: string[] = [];
  for (const block of parseBlocks(markdown)) {
    if (block.kind === 'blank') {
      out.push('');
    } else if (block.kind === 'code') {
      out.push(...block.lines);
    } else if (block.kind === 'heading') {
      out.push(block.text);
    } else if (block.kind === 'quote') {
      out.push(`> ${block.text}`);
    } else if (block.kind === 'list') {
      out.push(`${block.marker} ${block.text}`);
    } else {
      out.push(stripInlineMarkdown(block.text));
    }
  }
  return out.join('\n').trimEnd();
}

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /(`([^`]+)`|\[([^\]]+)]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) });
    if (match[2] !== undefined) segments.push({ kind: 'code', text: match[2] });
    else if (match[3] !== undefined && match[4] !== undefined) {
      segments.push({ kind: 'link', label: match[3], url: match[4] });
    } else if (match[5] !== undefined || match[6] !== undefined) {
      segments.push({ kind: 'strong', text: match[5] ?? match[6] ?? '' });
    } else {
      segments.push({ kind: 'em', text: match[7] ?? match[8] ?? '' });
    }
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

function InlineMarkdown({ text }: { text: string }): React.ReactElement {
  return (
    <>
      {parseInline(text).map((segment, index) => {
        const key = `${segment.kind}-${index}`;
        if (segment.kind === 'code') {
          return (
            <Text key={key} color="cyan">
              {segment.text}
            </Text>
          );
        }
        if (segment.kind === 'strong') {
          return (
            <Text key={key} bold={true}>
              {segment.text}
            </Text>
          );
        }
        if (segment.kind === 'em') {
          return (
            <Text key={key} italic={true}>
              {segment.text}
            </Text>
          );
        }
        if (segment.kind === 'link') {
          return (
            <React.Fragment key={key}>
              <Text color="cyan" underline={true}>
                {segment.label}
              </Text>
              <Text dimColor={true}> ({segment.url})</Text>
            </React.Fragment>
          );
        }
        return <React.Fragment key={key}>{segment.text}</React.Fragment>;
      })}
    </>
  );
}

function SyntaxBlock({ lang, lines }: { lang?: string; lines: string[] }): React.ReactElement {
  const highlighted = useHighlightedCode(lines.join('\n'), lang);
  return (
    <>
      {highlighted.map((line, lineIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: code fence lines have no stable identity beyond order.
        <Text key={`line-${lineIndex}`}>
          {line.map((segment, segmentIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: token identity is positional inside one immutable rendered line.
            <Text key={`${segment.text}-${segmentIndex}`} color={segment.color} dimColor={segment.dimColor}>
              {segment.text}
            </Text>
          ))}
        </Text>
      ))}
    </>
  );
}

export function MarkdownText({ children }: { children: string }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {parseBlocks(children).map((block, index) => {
        const key = `md-${index}`;
        if (block.kind === 'blank') return <Text key={key}> </Text>;
        if (block.kind === 'code') {
          return (
            <Box key={key} flexDirection="column" paddingLeft={1}>
              <SyntaxBlock lang={block.lang} lines={block.lines.length > 0 ? block.lines : ['']} />
            </Box>
          );
        }
        if (block.kind === 'heading') {
          return (
            <Text key={key} bold={true} color={block.depth <= 2 ? 'cyan' : undefined}>
              {block.text}
            </Text>
          );
        }
        if (block.kind === 'quote') {
          return (
            <Text key={key} dimColor={true}>
              {'> '}
              <InlineMarkdown text={block.text} />
            </Text>
          );
        }
        if (block.kind === 'list') {
          return (
            <Text key={key}>
              <Text color="cyan">{block.marker}</Text> <InlineMarkdown text={block.text} />
            </Text>
          );
        }
        return (
          <Text key={key}>
            <InlineMarkdown text={block.text} />
          </Text>
        );
      })}
    </Box>
  );
}
