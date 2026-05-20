import { describe, expect, it } from 'bun:test';
import { CATPPUCCIN_MOCHA, highlightCode, highlightCodeLine, markdownToPlainText } from './MarkdownText';

describe('markdownToPlainText', () => {
  it('strips heading markers', () => {
    expect(markdownToPlainText('# Title\n### Details')).toBe('Title\nDetails');
  });

  it('keeps list markers visible', () => {
    expect(markdownToPlainText('- one\n* two\n1. three')).toBe('- one\n* two\n1. three');
  });

  it('keeps blockquote markers visible', () => {
    expect(markdownToPlainText('> quoted text')).toBe('> quoted text');
  });

  it('strips code fences while keeping code lines', () => {
    expect(markdownToPlainText('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('ignores code fence languages in plain text', () => {
    expect(markdownToPlainText('```json\n{"ok": true}\n```')).toBe('{"ok": true}');
  });

  it('renders links as label plus url', () => {
    expect(markdownToPlainText('[docs](https://example.com)')).toBe('docs (https://example.com)');
  });

  it('strips inline code and emphasis markers', () => {
    expect(markdownToPlainText('Use `bun test` with **bold** and _em_')).toBe('Use bun test with bold and em');
  });
});

describe('highlightCodeLine', () => {
  it('uses Shiki with Catppuccin Mocha for supported languages', async () => {
    const lines = await highlightCode('const name = "mu";', 'ts');
    const segments = lines[0] ?? [];
    expect(segments.map((segment) => segment.text).join('')).toBe('const name = "mu";');
    expect(segments.some((segment) => segment.color && segment.color !== CATPPUCCIN_MOCHA.plain)).toBe(true);
  });

  it('falls back to basic highlighting for unsupported languages', async () => {
    const lines = await highlightCode('def greet(name): return "hi" # comment', 'madeuplang');
    const segments = lines[0] ?? [];
    expect(segments).toContainEqual({ text: 'def', color: CATPPUCCIN_MOCHA.keyword, dimColor: false });
    expect(segments.at(-1)).toEqual({ text: '# comment', color: CATPPUCCIN_MOCHA.comment, dimColor: true });
  });

  it('uses Catppuccin colors for TypeScript keywords, strings, and comments', () => {
    const segments = highlightCodeLine('const name = "mu"; // hello', 'ts');
    expect(segments).toContainEqual({ text: 'const', color: CATPPUCCIN_MOCHA.keyword, dimColor: false });
    expect(segments).toContainEqual({ text: '"mu"', color: CATPPUCCIN_MOCHA.string, dimColor: false });
    expect(segments.at(-1)).toEqual({ text: '// hello', color: CATPPUCCIN_MOCHA.comment, dimColor: true });
  });

  it('colors JSON keys and booleans', () => {
    const segments = highlightCodeLine('{"ok": true}', 'json');
    expect(segments).toContainEqual({ text: '"ok"', color: CATPPUCCIN_MOCHA.property, dimColor: false });
    expect(segments).toContainEqual({ text: 'true', color: CATPPUCCIN_MOCHA.number, dimColor: false });
  });

  it('colors shell commands, flags, strings, and comments', () => {
    const segments = highlightCodeLine('bun test --watch "src" # loop', 'bash');
    expect(segments).toContainEqual({ text: 'bun', color: CATPPUCCIN_MOCHA.function, dimColor: false });
    expect(segments).toContainEqual({ text: '--watch', color: CATPPUCCIN_MOCHA.comment, dimColor: false });
    expect(segments).toContainEqual({ text: '"src"', color: CATPPUCCIN_MOCHA.string, dimColor: false });
    expect(segments.at(-1)).toEqual({ text: '# loop', color: CATPPUCCIN_MOCHA.comment, dimColor: true });
  });

  it('basic-highlights unsupported languages with common syntax rules', () => {
    const segments = highlightCodeLine('def greet(name): return "hi" # comment', 'python');
    expect(segments).toContainEqual({ text: 'def', color: CATPPUCCIN_MOCHA.keyword, dimColor: false });
    expect(segments).toContainEqual({ text: 'greet', color: CATPPUCCIN_MOCHA.function, dimColor: false });
    expect(segments).toContainEqual({ text: 'return', color: CATPPUCCIN_MOCHA.keyword, dimColor: false });
    expect(segments).toContainEqual({ text: '"hi"', color: CATPPUCCIN_MOCHA.string, dimColor: false });
    expect(segments.at(-1)).toEqual({ text: '# comment', color: CATPPUCCIN_MOCHA.comment, dimColor: true });
  });

  it('basic-highlights unsupported types, numbers, and operators', () => {
    const segments = highlightCodeLine('func main() { count := 42 }', 'go');
    expect(segments).toContainEqual({ text: 'func', color: CATPPUCCIN_MOCHA.keyword, dimColor: false });
    expect(segments).toContainEqual({ text: 'main', color: CATPPUCCIN_MOCHA.function, dimColor: false });
    expect(segments).toContainEqual({ text: '42', color: CATPPUCCIN_MOCHA.number, dimColor: false });
    expect(segments).toContainEqual({ text: '{', color: CATPPUCCIN_MOCHA.operator, dimColor: false });
  });

  it('basic-highlights fences without a language', () => {
    const segments = highlightCodeLine('Result = true -- done');
    expect(segments).toContainEqual({ text: 'Result', color: CATPPUCCIN_MOCHA.type, dimColor: false });
    expect(segments).toContainEqual({ text: 'true', color: CATPPUCCIN_MOCHA.number, dimColor: false });
    expect(segments.at(-1)).toEqual({ text: '-- done', color: CATPPUCCIN_MOCHA.comment, dimColor: true });
  });
});
