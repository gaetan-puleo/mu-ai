import { transformSync } from '@swc/wasm-typescript';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TS_EXT = /\.(?:[cm]?ts|tsx)$/;
const REMOTE = /^(?:npm|jsr|node|bun|http|https|data|file):/;
const SPECIFIER = /(?:\bfrom|\bimport|\bexport\s*\*\s*from|\bimport)\s*\(?\s*(['"])(\.{1,2}\/[^'"]+)\1/g;

const isLocalTs = (spec: string): boolean => TS_EXT.test(spec) && !REMOTE.test(spec);

const toAbs = (spec: string): string => {
  if (spec.startsWith('file://')) return resolve(decodeURIComponent(new URL(spec).pathname));
  return isAbsolute(spec) ? spec : resolve(spec);
};

const resolveRelative = async (from: string, spec: string): Promise<string> => {
  const base = resolve(dirname(from), spec);
  const candidates = TS_EXT.test(base) ? [base] : [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`cannot resolve "${spec}" from ${from}`);
};

const collect = async (entry: string): Promise<Map<string, string>> => {
  const sources = new Map<string, string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (sources.has(file)) continue;
    const source = await readFile(file, 'utf-8');
    sources.set(file, source);
    for (const match of source.matchAll(SPECIFIER)) {
      pending.push(await resolveRelative(file, match[2]));
    }
  }
  return sources;
};

const commonBase = (files: string[]): string => {
  if (files.length === 1) return dirname(files[0]);
  const split = files.map((f) => dirname(f).split(sep));
  const first = split[0];
  let i = 0;
  while (i < first.length && split.every((parts) => parts[i] === first[i])) i++;
  return first.slice(0, i).join(sep) || sep;
};

const outName = (path: string): string => path.replace(TS_EXT, '.mjs');

const rewriteSpecifiers = (code: string): string =>
  code.replace(
    SPECIFIER,
    (whole, quote, spec) => whole.replace(`${quote}${spec}${quote}`, `${quote}${outName(spec)}${quote}`),
  );

const transpileTree = async (entry: string): Promise<string> => {
  const sources = await collect(entry);
  if (sources.size === 1) {
    const { code } = transformSync(sources.get(entry) as string, { mode: 'transform', module: true });
    return `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`;
  }
  const base = commonBase([...sources.keys()]);
  const outDir = await mkdtemp(join(tmpdir(), 'mu-plugin-'));
  for (const [file, source] of sources) {
    const { code } = transformSync(source, { mode: 'transform', module: true });
    const out = join(outDir, outName(relative(base, file)));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, rewriteSpecifiers(code), 'utf-8');
  }
  return pathToFileURL(join(outDir, outName(relative(base, entry)))).href;
};

export const importModule = async (spec: string): Promise<Record<string, unknown>> => {
  if (!isLocalTs(spec)) return (await import(spec)) as Record<string, unknown>;
  const url = await transpileTree(toAbs(spec));
  return (await import(url)) as Record<string, unknown>;
};
