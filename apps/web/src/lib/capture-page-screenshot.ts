import { toPng } from "html-to-image";

function isTinyDataUrl(dataUrl: string | null | undefined): boolean {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return true;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return true;
  // Empty / 1x1 / cleared WebGL buffers compress to a tiny payload.
  return dataUrl.length - comma < 1_500;
}

/**
 * Ask The Graph to render one frame and return gl.domElement.toDataURL.
 * Resolves null if the Graph is not mounted.
 */
function snapshotGraphWebgl(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(url);
    };
    const timer = window.setTimeout(() => finish(null), 400);
    window.dispatchEvent(
      new CustomEvent("godmode:graph-screenshot", {
        detail: { resolve: finish },
      })
    );
  });
}

type StyleSnapshot = { el: HTMLElement; cssText: string };

/**
 * html-to-image often drops or misplaces `position: fixed` chrome when the
 * capture root is not the viewport. Temporarily pin those nodes to absolute
 * coords on the live tree (restored after capture).
 */
function pinFixedChromeLive(liveRoot: HTMLElement): StyleSnapshot[] {
  const rootRect = liveRoot.getBoundingClientRect();
  const liveFixed = Array.from(
    liveRoot.querySelectorAll<HTMLElement>("*")
  ).filter((el) => window.getComputedStyle(el).position === "fixed");

  const snaps: StyleSnapshot[] = [];
  for (const live of liveFixed) {
    snaps.push({ el: live, cssText: live.style.cssText });
    const rect = live.getBoundingClientRect();
    live.style.position = "absolute";
    live.style.top = `${rect.top - rootRect.top}px`;
    live.style.left = `${rect.left - rootRect.left}px`;
    live.style.width = `${rect.width}px`;
    live.style.height = `${rect.height}px`;
    live.style.right = "auto";
    live.style.bottom = "auto";
    live.style.margin = "0";
    live.style.transform = "none";
    live.style.zIndex = window.getComputedStyle(live).zIndex || "1";
  }
  return snaps;
}

type CanvasSwap = { canvas: HTMLCanvasElement; img: HTMLImageElement };

/**
 * Swap live canvases for static images so html-to-image captures WebGL pixels.
 */
function swapCanvasesForImages(
  liveRoot: HTMLElement,
  canvasSnaps: Array<string | null>
): CanvasSwap[] {
  const liveCanvases = Array.from(liveRoot.querySelectorAll("canvas"));
  const rootRect = liveRoot.getBoundingClientRect();
  const swaps: CanvasSwap[] = [];
  liveCanvases.forEach((canvas, i) => {
    const dataUrl = canvasSnaps[i];
    if (!dataUrl || dataUrl === "data:," || isTinyDataUrl(dataUrl)) return;
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "Graph canvas";
    img.className = canvas.className;
    const style = canvas.getAttribute("style");
    if (style) img.setAttribute("style", style);
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      img.style.position = "absolute";
      img.style.left = `${rect.left - rootRect.left}px`;
      img.style.top = `${rect.top - rootRect.top}px`;
      img.style.width = `${rect.width}px`;
      img.style.height = `${rect.height}px`;
    }
    img.style.display = "block";
    img.style.objectFit = "cover";
    img.style.pointerEvents = "none";
    canvas.replaceWith(img);
    swaps.push({ canvas, img });
  });
  return swaps;
}

function restoreCanvasSwaps(swaps: CanvasSwap[]): void {
  for (const { canvas, img } of swaps) {
    img.replaceWith(canvas);
  }
}

function restoreStyleSnaps(snaps: StyleSnapshot[]): void {
  for (const { el, cssText } of snaps) {
    el.style.cssText = cssText;
  }
}

/**
 * Capture the visible GodMode shell as a PNG data URL (full viewport chrome:
 * ticker, composer, rails, floating windows, and The Graph).
 *
 * The Graph WebGL canvas lives outside `<main>`; capturing `main` alone yields
 * a black/empty shot on Graph view. WebGL is snapshotted via a sync render,
 * then swapped into the live DOM for html-to-image (no unsupported onclone).
 */
export async function capturePageScreenshot(): Promise<string | null> {
  const target =
    (document.querySelector(
      "[data-godmode-capture-root]"
    ) as HTMLElement | null) ??
    (document.querySelector(
      "[data-godmode-graph-root]"
    ) as HTMLElement | null) ??
    document.body;
  if (!target) return null;

  const graphShot = await snapshotGraphWebgl();
  const graphRoot = document.querySelector("[data-godmode-graph-root]");

  const liveCanvases = Array.from(target.querySelectorAll("canvas"));
  const canvasSnaps = liveCanvases.map((canvas) => {
    if (
      graphShot &&
      !isTinyDataUrl(graphShot) &&
      graphRoot?.contains(canvas)
    ) {
      return graphShot;
    }
    try {
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  });

  const styleSnaps = pinFixedChromeLive(target);
  const canvasSwaps = swapCanvasesForImages(target, canvasSnaps);
  try {
    const png = await toPng(target, {
      cacheBust: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: "#0a0a0a",
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        // Keep page chrome (ticker, composer, rails). Only skip ephemeral toasts.
        if (node.getAttribute("data-sonner-toaster") != null) return false;
        return true;
      },
    });
    if (png && !isTinyDataUrl(png)) return png;
  } catch {
    /* fall through to graph-only */
  } finally {
    restoreCanvasSwaps(canvasSwaps);
    restoreStyleSnaps(styleSnaps);
  }

  if (graphShot && !isTinyDataUrl(graphShot)) return graphShot;
  return null;
}
