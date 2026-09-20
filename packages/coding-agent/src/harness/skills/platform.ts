const PLATFORM_MAP: Record<string, string> = { macos: 'darwin', linux: 'linux', windows: 'win32' };

export const skillMatchesPlatform = (
  platforms: string[] | undefined,
  current: string = process.platform,
): boolean => {
  if (!platforms || platforms.length === 0) return true;
  return platforms.some((p) => {
    const mapped = PLATFORM_MAP[p.trim().toLowerCase()];
    return mapped !== undefined && current.startsWith(mapped);
  });
};
