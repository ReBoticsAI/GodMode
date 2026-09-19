/**
 * Graph land chrome bands and stacking.
 *
 * Primary chrome (ticker, notice, rails, composer / focus pill) stays above
 * secondary FloatingWindow / phone Sheet surfaces.
 *
 * Pixel bands are measured live from `[data-graph-top-chrome]` /
 * `[data-graph-footer-chrome]` when present. These CSS fallbacks must clear
 * the focus/reply pill + composer input even before measurement runs.
 */

/** Top inset fallback: top-4 + ticker (h-8) + gap + notice (h-7) + slack. */
export const GRAPH_TOP_CHROME_BAND =
  "calc(1rem + 2rem + 0.375rem + 1.75rem + 0.5rem)";

/**
 * Bottom inset fallback: footer pt-2 + focus/reply pill (h-7) + gap-2 +
 * composer (h-12) + pb + slack. Must clear the "Replying to …" pill.
 */
export const GRAPH_COMPOSER_BAND =
  "calc(0.5rem + 1.75rem + 0.5rem + 3rem + max(1rem, env(safe-area-inset-bottom, 0px)) + 0.5rem)";

/** Primary page chrome (footer composer, top ticker/notice, tool rails). */
export const GRAPH_PRIMARY_CHROME_Z = "z-[210]";

/** Secondary surfaces (FloatingWindow, GraphPhoneSheet). Below primary chrome. */
export const GRAPH_WINDOW_Z = "z-[110]";

export const GRAPH_WINDOW_BOUNDS_SELECTOR = "[data-graph-window-bounds]";
export const GRAPH_TOP_CHROME_SELECTOR = "[data-graph-top-chrome]";
export const GRAPH_FOOTER_CHROME_SELECTOR = "[data-graph-footer-chrome]";

/** Fired after live top/footer band CSS vars are updated. */
export const GRAPH_CHROME_BANDS_EVENT = "godmode:graph-chrome-bands";
