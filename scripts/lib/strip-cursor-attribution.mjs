/**
 * Shared Cursor attribution strip helpers (Cloud/SDK injects trailers
 * even when IDE Attribution is OFF).
 */

export const CURSOR_ATTRIBUTION_RE =
  /^(Co-authored-by:\s*Cursor\s*<[^>\n]*cursor\.com>|Made-with:\s*Cursor|Made with Cursor)\s*$/gim;

export function stripCursorAttributionMessage(message) {
  const cleaned = String(message ?? "")
    .replace(CURSOR_ATTRIBUTION_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned ? `${cleaned}\n` : "\n";
}

export function messageHasCursorAttribution(message) {
  return CURSOR_ATTRIBUTION_RE.test(String(message ?? ""));
}
