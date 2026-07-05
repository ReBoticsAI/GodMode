/** GodMode plugin engine version — plugins declare compatible range in manifest.engine */
export const GODMODE_ENGINE_VERSION = "0.1.0";

/**
 * Minimal semver check: supports exact match and caret (^0.1.0).
 */
export function assertEngineCompatible(manifest: { id: string; engine?: string }): void {
  const required = manifest.engine?.trim();
  if (!required) return;

  const host = GODMODE_ENGINE_VERSION;
  const parse = (v: string): [number, number, number] => {
    const m = v.replace(/^[\^~>=<]+/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) throw new Error(`Invalid semver: ${v}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };

  if (required.startsWith("^")) {
    const [, hostMinor] = parse(host);
    const [, reqMinor] = parse(required);
    const [hostMajor] = parse(host);
    const [reqMajor] = parse(required);
    if (hostMajor !== reqMajor || hostMinor !== reqMinor) {
      throw new Error(
        `Plugin ${manifest.id} requires engine ${required} but host is ${host}`
      );
    }
    return;
  }

  if (required !== host) {
    throw new Error(
      `Plugin ${manifest.id} requires engine ${required} but host is ${host}`
    );
  }
}
