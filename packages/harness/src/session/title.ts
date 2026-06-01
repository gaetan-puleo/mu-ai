export const titleFallback = (text: string, max = 50): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

export const cleanTitle = (raw: string, max = 60): string => {
  const line = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0) ?? '';
  const unquoted = line.replace(/^["'`]+|["'`]+$/g, '').trim();
  return unquoted.length > max ? `${unquoted.slice(0, max - 1)}…` : unquoted;
};

export interface RunTitlerOptions {
  id: string;
  text: string;
  setTitle(id: string, title: string): void | Promise<void>;
  generate(text: string): Promise<string>;
}

export const runTitler = async (options: RunTitlerOptions): Promise<void> => {
  await options.setTitle(options.id, titleFallback(options.text));
  try {
    const title = cleanTitle(await options.generate(options.text));
    if (title) await options.setTitle(options.id, title);
  } catch {
    // keep the fallback
  }
};
