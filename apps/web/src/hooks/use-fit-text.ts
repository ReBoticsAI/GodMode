import { useLayoutEffect, useRef } from "react";

type FitTextOptions = {
  /** Preferred size when the label fits (px). Defaults to 16 (`text-base`). */
  maxPx?: number;
  /** Smallest allowed size before giving up (px). Defaults to 10. */
  minPx?: number;
};

/**
 * Shrinks an element's font size so its text stays on one line within its
 * laid-out width. Measures with `scrollWidth` vs `clientWidth` and binary-
 * searches between `minPx` and `maxPx`. Re-fits on resize via ResizeObserver.
 *
 * The element should use `whitespace-nowrap` and `min-w-0` (or otherwise have
 * a bounded width from flex/grid). Font size is applied via `style.fontSize`
 * so callers can keep Tailwind weight/tracking classes on a parent.
 */
export function useFitText(text: string, options: FitTextOptions = {}) {
  const { maxPx = 16, minPx = 10 } = options;
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      const width = el.clientWidth;
      if (width <= 0) return;

      el.style.fontSize = `${maxPx}px`;
      if (el.scrollWidth <= width + 0.5) return;

      let lo = minPx;
      let hi = maxPx;
      let best = minPx;
      while (hi - lo > 0.25) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (el.scrollWidth <= width + 0.5) {
          best = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      el.style.fontSize = `${best}px`;
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => {
      observer.disconnect();
      el.style.fontSize = "";
    };
  }, [text, maxPx, minPx]);

  return ref;
}
