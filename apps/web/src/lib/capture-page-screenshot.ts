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

/**
 * html-to-image often drops or misplaces `position: fixed` chrome when the
 * capture root is not the viewport. Pin those nodes to absolute coords in the
 * clone so ticker / composer / rails stay in the shot.
 */
function pinFixedChromeInClone(
  liveRoot: HTMLElement,
  clonedRoot: HTMLElement
): void {
  const rootRect = liveRoot.getBoundingClientRect();
  const liveFixed = Array.from(liveRoot.querySelectorAll<HTMLElement>("*")).filter(
    (el) => {
      const pos = window.getComputedStyle(el).position;
      return pos === "fixed";
    }
  );

  for (const live of liveFixed) {
    const path: number[] = [];
    let node: Element | null = live;
    while (node && node !== liveRoot) {
      const parent = node.parentElement;
      if (!parent) break;
      path.push(Array.from(parent.children).indexOf(node));
      node = parent;
    }
    if (node !== liveRoot) continue;

    let cloned: Element = clonedRoot;
    for (let i = path.length - 1; i >= 0; i--) {
      const next = cloned.children[path[i]!];
      if (!next) {
        cloned = clonedRoot;
        break;
      }
      cloned = next;
    }
    if (!(cloned instanceof HTMLElement) || cloned === clonedRoot) continue;

    const rect = live.getBoundingClientRect();
    cloned.style.position = "absolute";
    cloned.style.top = `${rect.top - rootRect.top}px`;
    cloned.style.left = `${rect.left - rootRect.left}px`;
    cloned.style.width = `${rect.width}px`;
    cloned.style.height = `${rect.height}px`;
    cloned.style.right = "auto";
    cloned.style.bottom = "auto";
    cloned.style.margin = "0";
    cloned.style.transform = "none";
    cloned.style.zIndex = window.getComputedStyle(live).zIndex || "1";
  }
}

/**
 * Capture the visible GodMode shell as a PNG data URL (full viewport chrome:
 * ticker, composer, rails, floating windows, and The Graph).
 *
 * The Graph WebGL canvas lives outside `<main>`; capturing `main` alone yields
 * a black/empty shot on Graph view. WebGL is snapshotted via a sync render,
 * then swapped into the DOM clone.
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
      onclone: (_doc, cloned) => {
        pinFixedChromeInClone(target, cloned);

        const clonedCanvases = Array.from(cloned.querySelectorAll("canvas"));
        clonedCanvases.forEach((canvas, i) => {
          const dataUrl = canvasSnaps[i];
          if (!dataUrl || dataUrl === "data:," || isTinyDataUrl(dataUrl)) {
            return;
          }
          const img = cloned.ownerDocument.createElement("img");
          img.src = dataUrl;
          img.alt = "Graph canvas";
          img.className = canvas.className;
          const style = canvas.getAttribute("style");
          if (style) img.setAttribute("style", style);
          const rect = liveCanvases[i]?.getBoundingClientRect();
          const rootRect = target.getBoundingClientRect();
          if (rect && rect.width > 0 && rect.height > 0) {
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
        });
      },
    });
    if (png && !isTinyDataUrl(png)) return png;
  } catch {
    /* fall through to graph-only */
  }

  if (graphShot && !isTinyDataUrl(graphShot)) return graphShot;
  return null;
}
