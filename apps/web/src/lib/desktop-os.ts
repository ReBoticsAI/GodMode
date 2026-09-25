export type DesktopOs = "windows" | "macos" | "linux";

/** Desktop OS for the local GodMode download offer. Phones are not a desktop build. */
export function detectDesktopOs(userAgent: string): DesktopOs | null {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return null;
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "macos";
  if (/Linux/i.test(userAgent)) return "linux";
  return null;
}

export function detectDesktopOsFromNavigator(): DesktopOs | null {
  if (typeof navigator === "undefined") return null;
  return detectDesktopOs(navigator.userAgent);
}
