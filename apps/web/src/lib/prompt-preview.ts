/** Marker inserted between head and tail when a prompt is truncated for UI. */
export const PROMPT_PREVIEW_ELLIPSIS = "\n\n… [truncated] …\n\n";

const DEFAULT_THRESHOLD = 4_000;
const DEFAULT_HEAD = 2_000;
const DEFAULT_TAIL = 1_000;

/**
 * Truncate a long prompt for inspector preview: keep head + tail when over threshold.
 * Returns the original string when at or under threshold.
 */
export function truncatePromptPreview(
  text: string,
  opts?: {
    threshold?: number;
    head?: number;
    tail?: number;
  }
): { text: string; truncated: boolean } {
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const head = opts?.head ?? DEFAULT_HEAD;
  const tail = opts?.tail ?? DEFAULT_TAIL;
  if (text.length <= threshold) {
    return { text, truncated: false };
  }
  const start = text.slice(0, head);
  const end = text.slice(-tail);
  return {
    text: `${start}${PROMPT_PREVIEW_ELLIPSIS}${end}`,
    truncated: true,
  };
}
