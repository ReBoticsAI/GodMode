import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Shrinks font so the full label fits the flex slot. Stops at `minPx`; beyond
 * that, CSS truncate + title still apply for absurdly long names.
 */
export function FitText({
  text,
  className,
  maxPx,
  minPx = 11,
}: {
  text: string;
  className?: string;
  /** Starting size in CSS pixels (e.g. 30 ≈ text-3xl). */
  maxPx: number;
  minPx?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxPx);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    let lo = minPx;
    let hi = maxPx;
    let best = minPx;
    el.style.fontSize = `${maxPx}px`;

    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      if (el.scrollWidth <= el.clientWidth + 1) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    setFontSize(Math.floor(best * 10) / 10);
  }, [maxPx, minPx, text]);

  useEffect(() => {
    fit();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <span
      ref={ref}
      title={text}
      className={cn(
        "block min-w-0 flex-1 truncate whitespace-nowrap text-left leading-none",
        className
      )}
      style={{ fontSize: `${fontSize}px` }}
    >
      {text}
    </span>
  );
}
