import type { SVGProps } from "react";

/**
 * Brand mark: a balance growing from $0.00 up to $1,000,000.00 — each line
 * larger (and bolder/brighter) than the one below it to read as upward growth.
 * Inherits `currentColor`. Width scales with height; size via `className`
 * (e.g. `h-8 w-auto`).
 */
export function GrowingBalanceIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  const fontFamily =
    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  return (
    <svg
      viewBox="0 0 100 34"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <text
        x="1"
        y="12"
        fontSize="12"
        fontWeight="800"
        fontFamily={fontFamily}
        textLength="98"
        lengthAdjust="spacingAndGlyphs"
      >
        $1,000,000.00
      </text>
      <text
        x="1"
        y="23.5"
        fontSize="8"
        fontWeight="700"
        fontFamily={fontFamily}
        opacity="0.8"
      >
        $100.00
      </text>
      <text
        x="1"
        y="32"
        fontSize="5.5"
        fontWeight="700"
        fontFamily={fontFamily}
        opacity="0.55"
      >
        $0.00
      </text>
    </svg>
  );
}
