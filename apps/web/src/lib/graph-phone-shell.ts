import { PHONE_BREAKPOINT } from "@/hooks/use-mobile";

/** Sync check for Graph phone shell (&lt; 640px). Safe in event handlers. */
export function isPhoneViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(
    `(max-width: ${PHONE_BREAKPOINT - 1}px)`
  ).matches;
}
