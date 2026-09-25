import { useEffect, useState } from "react";

/**
 * Width below which the app switches to "compact mode": the left nav and the
 * right trading/markets panels become off-canvas drawers instead of static
 * sidebars. Matches Tailwind's `lg` breakpoint so it lines up with the
 * `lg:flex` / `lg:hidden` utility classes used in the chrome.
 */
export const MOBILE_BREAKPOINT = 1024;

/**
 * Graph phone shell breakpoint (&lt; 640px). Matches FloatingWindow's historical
 * `max-width: 639px` phone full-bleed. Tablets 640–1023 keep multi-window float.
 */
export const PHONE_BREAKPOINT = 640;

/** Returns true when the viewport is narrower than {@link MOBILE_BREAKPOINT}. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

/** Returns true when the viewport is narrower than {@link PHONE_BREAKPOINT}. */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(`(max-width: ${PHONE_BREAKPOINT - 1}px)`).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${PHONE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsPhone(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isPhone;
}
