const PLATFORM_MAP: Record<string, string> = { macos: 'darwin', linux: 'linux', windows: 'win32' };

/**
 * Mirror of Hermes' `skill_matches_platform`. Returns true when a skill is compatible
 * with the current OS. Empty/absent `platforms` matches every OS. `current` is a
 * `process.platform` value ('darwin' | 'linux' | 'win32'); injectable for testing.
 */
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
