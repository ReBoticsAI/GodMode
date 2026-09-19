import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile, useIsPhone } from "@/hooks/use-mobile";
import {
  focusWindowAnchors,
  snapToFocusAnchor,
} from "@/lib/floating-window-anchors";
import { getFloatingWindowBounds } from "@/lib/floating-window-bounds";
import {
  GRAPH_CHROME_BANDS_EVENT,
  GRAPH_WINDOW_BOUNDS_SELECTOR,
  GRAPH_WINDOW_Z,
} from "@/lib/graph-chrome-layout";
import type { FloatingWindowRole } from "@/lib/floating-window-registry";
import {
  anchorWindowAndMirror,
  registerFloatingWindow,
  setActiveFloatingWindow,
} from "@/lib/floating-window-registry";
import { snapRectToGrid } from "@/lib/floating-window-grid";
import {
  readFloatingWindowLayout,
  writeFloatingWindowLayout,
} from "@/lib/floating-window-layout-store";

export type FloatingWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export { getFloatingWindowBounds };

function clampPos(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: FloatingWindowBounds
): { x: number; y: number } {
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - width);
  const maxY = Math.max(bounds.y, bounds.y + bounds.height - height);
  return {
    x: Math.round(Math.max(bounds.x, Math.min(maxX, x))),
    y: Math.round(Math.max(bounds.y, Math.min(maxY, y))),
  };
}

export type FloatingWindowPlacement =
  | "left"
  | "right"
  | "center"
  | "focus-left"
  | "focus-right";

export type FloatingWindowProps = {
  open: boolean;
  minimized?: boolean;
  onMinimize?: () => void;
  title: ReactNode;
  icon?: ReactNode;
  /** Accent color for top bar / border (hex). */
  accent?: string;
  zIndexClassName?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  /** Where to place on first open (horizontal). */
  placement?: FloatingWindowPlacement;
  /**
   * Vertical edge on first open when not using focus anchors.
   * Prefer focus-left / focus-right placement for Graph companion windows.
   */
  anchorY?: "top" | "bottom";
  /** Registry id for Grid / Anchor (required for multi-window snap). */
  windowId?: string;
  role?: FloatingWindowRole;
  pairGroup?: "focus-pair";
  onClose: () => void;
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Shared floating window chrome: drag, edge/corner resize, maximize, close.
 * Spawn many of these; only the body content changes per window type.
 */
export function FloatingWindow({
  open,
  minimized = false,
  onMinimize,
  title,
  icon,
  accent = "#a78bfa",
  zIndexClassName = GRAPH_WINDOW_Z,
  defaultWidth = 400,
  /** Fills the Graph playfield height when bounds are known; clamped on open. */
  defaultHeight = 720,
  minWidth = 280,
  minHeight = 240,
  placement = "right",
  anchorY = "top",
  windowId,
  role = "generic",
  pairGroup,
  onClose,
  headerActions,
  children,
  className,
}: FloatingWindowProps) {
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const asideRef = useRef<HTMLElement | null>(null);
  const [anchorPickMode, setAnchorPickMode] = useState(false);

  const [bounds, setBounds] = useState<FloatingWindowBounds>(() =>
    getFloatingWindowBounds()
  );
  const [width, setWidth] = useState(defaultWidth);
  const [height, setHeight] = useState(defaultHeight);
  const [x, setX] = useState<number | null>(null);
  const [y, setY] = useState<number | null>(null);
  const [maximized, setMaximized] = useState(false);
  const placedForOpen = useRef(false);

  const persistLayout = useCallback(
    (next: { x: number; y: number; width: number; height: number }) => {
      if (!windowId || maximized) return;
      writeFloatingWindowLayout(windowId, next);
    },
    [windowId, maximized]
  );

  useEffect(() => {
    if (!open) {
      placedForOpen.current = false;
      setMaximized(false);
      // Keep last in-memory size; restore from storage (or defaults) on next open.
      setX(null);
      setY(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const recompute = () => setBounds(getFloatingWindowBounds());
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener(GRAPH_CHROME_BANDS_EVENT, recompute);
    const main = document.querySelector("main");
    const playfield = document.querySelector(GRAPH_WINDOW_BOUNDS_SELECTOR);
    const observer = new ResizeObserver(recompute);
    if (main) observer.observe(main);
    if (playfield) observer.observe(playfield);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener(GRAPH_CHROME_BANDS_EVENT, recompute);
      observer.disconnect();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || placedForOpen.current || maximized) return;
    const b = getFloatingWindowBounds();
    setBounds(b);

    const saved = windowId ? readFloatingWindowLayout(windowId) : null;
    if (saved) {
      const w = Math.max(minWidth, Math.min(saved.width, b.width - 24));
      const h = Math.max(minHeight, Math.min(saved.height, b.height - 16));
      const pos = clampPos(saved.x, saved.y, w, h, b);
      setWidth(w);
      setHeight(h);
      setX(pos.x);
      setY(pos.y);
      placedForOpen.current = true;
      return;
    }

    const maxPairedWidth =
      pairGroup === "focus-pair" && b.width < 1440
        ? Math.max(minWidth, Math.floor((b.width - 120) / 2))
        : b.width - 24;
    const w = Math.min(defaultWidth, Math.max(minWidth, maxPairedWidth));
    // Default height fills the playfield (under ticker, above composer pill).
    const h = Math.min(
      defaultHeight,
      Math.max(minHeight, b.height - 16)
    );
    setWidth(w);
    setHeight(h);
    const focus = focusWindowAnchors(b, w, h);
    let nextX: number;
    let nextY: number;
    if (placement === "focus-left") {
      nextX = Math.max(b.x + 56, focus.left.x);
      nextY = focus.left.y;
    } else if (placement === "focus-right") {
      nextX = focus.right.x;
      nextY = focus.right.y;
    } else if (placement === "left") {
      nextX = b.x + 56;
      nextY = b.y + Math.max(8, Math.round((b.height - h) / 2));
    } else {
      nextX = b.x + 12;
      if (placement === "right") nextX = b.x + b.width - w - 12;
      if (placement === "center") nextX = b.x + Math.max(12, (b.width - w) / 2);
      nextY =
        anchorY === "bottom"
          ? b.y + b.height - h - 8
          : b.y + 8;
    }
    const pos = clampPos(nextX, nextY, w, h, b);
    setX(placement === "left" || placement === "focus-left" ? Math.max(b.x + 56, pos.x) : pos.x);
    setY(pos.y);
    placedForOpen.current = true;
  }, [
    open,
    maximized,
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
    placement,
    anchorY,
    windowId,
    pairGroup,
  ]);

  const currentWidth = maximized
    ? bounds.width
    : Math.min(width, Math.max(minWidth, bounds.width - 24));
  const currentHeight = maximized
    ? bounds.height
    : Math.min(height, Math.max(minHeight, bounds.height - 16));
  const pos =
    maximized || x == null || y == null
      ? { x: bounds.x, y: bounds.y }
      : clampPos(x, y, currentWidth, currentHeight, bounds);

  const layoutRef = useRef({
    x: pos.x,
    y: pos.y,
    width: currentWidth,
    height: currentHeight,
  });
  layoutRef.current = {
    x: pos.x,
    y: pos.y,
    width: currentWidth,
    height: currentHeight,
  };

  useEffect(() => {
    const onPick = (ev: Event) => {
      const active = Boolean(
        (ev as CustomEvent<{ active?: boolean }>).detail?.active
      );
      setAnchorPickMode(active);
    };
    window.addEventListener("godmode:anchor-pick-mode", onPick);
    return () => window.removeEventListener("godmode:anchor-pick-mode", onPick);
  }, []);

  useEffect(() => {
    if (!open || !windowId || maximized || isMobile) return;
    return registerFloatingWindow({
      id: windowId,
      role,
      pairGroup,
      getLayout: () => layoutRef.current,
      applyLayout: (rect) => {
        setX(rect.x);
        setY(rect.y);
        setWidth(rect.width);
        setHeight(rect.height);
        placedForOpen.current = true;
        writeFloatingWindowLayout(windowId, rect);
      },
    });
  }, [open, windowId, role, pairGroup, maximized, isMobile]);

  const handleDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // Phone fullscreen sheets are not draggable; desktop/tablet split panes still are.
      if (maximized || isPhone) return;
      if (e.button !== 0) return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("[data-floating-chrome]")
      ) {
        return;
      }

      if (anchorPickMode && windowId) {
        e.preventDefault();
        e.stopPropagation();
        anchorWindowAndMirror(windowId);
        window.dispatchEvent(
          new CustomEvent("godmode:anchor-pick-mode", {
            detail: { active: false },
          })
        );
        return;
      }

      if (windowId) setActiveFloatingWindow(windowId);

      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
      const activeBounds = getFloatingWindowBounds();
      setBounds(activeBounds);
      const startX = e.clientX;
      const startY = e.clientY;
      const originX = x ?? pos.x;
      const originY = y ?? pos.y;
      const el = e.currentTarget;
      el.setPointerCapture?.(e.pointerId);
      let lastX = originX;
      let lastY = originY;
      const onMove = (ev: PointerEvent) => {
        const next = clampPos(
          originX + (ev.clientX - startX),
          originY + (ev.clientY - startY),
          width,
          height,
          activeBounds
        );
        lastX = next.x;
        lastY = next.y;
        setX(next.x);
        setY(next.y);
      };
      const onUp = (ev: PointerEvent) => {
        try {
          el.releasePointerCapture?.(ev.pointerId);
        } catch {
          /* already released */
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        const gridSnapped = snapRectToGrid(
          { x: lastX, y: lastY, width, height },
          activeBounds
        );
        // Prefer soft focus-slot snap when near Chat/Info defaults; else grid.
        const focusSnapped = snapToFocusAnchor(
          lastX,
          lastY,
          width,
          height,
          activeBounds
        );
        if (focusSnapped) {
          setX(focusSnapped.x);
          setY(focusSnapped.y);
          persistLayout({
            x: focusSnapped.x,
            y: focusSnapped.y,
            width,
            height,
          });
        } else {
          setX(gridSnapped.x);
          setY(gridSnapped.y);
          persistLayout({
            x: gridSnapped.x,
            y: gridSnapped.y,
            width: gridSnapped.width,
            height: gridSnapped.height,
          });
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.style.cursor = "move";
      document.body.style.userSelect = "none";
    },
    [
      maximized,
      isPhone,
      x,
      y,
      pos.x,
      pos.y,
      width,
      height,
      anchorPickMode,
      windowId,
      persistLayout,
    ]
  );

  useEffect(() => {
    const onReset = () => {
      if (!open || maximized) return;
      const b = getFloatingWindowBounds();
      setBounds(b);
      const w = Math.min(defaultWidth, Math.max(minWidth, b.width - 24));
      const h = Math.min(defaultHeight, Math.max(minHeight, b.height - 16));
      setWidth(w);
      setHeight(h);
      const focus = focusWindowAnchors(b, w, h);
      const slot =
        placement === "focus-left"
          ? focus.left
          : placement === "focus-right"
            ? focus.right
            : placement === "left"
              ? focus.left
              : focus.right;
      setX(slot.x);
      setY(slot.y);
      placedForOpen.current = true;
      if (windowId) {
        writeFloatingWindowLayout(windowId, {
          x: slot.x,
          y: slot.y,
          width: w,
          height: h,
        });
      }
    };
    window.addEventListener("godmode:reset-window-anchors", onReset);
    return () =>
      window.removeEventListener("godmode:reset-window-anchors", onReset);
  }, [
    open,
    maximized,
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
    placement,
    windowId,
  ]);

  const startResize = useCallback(
    (
      e: ReactPointerEvent<HTMLDivElement>,
      mode:
        | "east"
        | "west"
        | "south"
        | "southeast"
        | "southwest"
    ) => {
      if (maximized || isPhone) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const activeBounds = getFloatingWindowBounds();
      setBounds(activeBounds);
      const startX = e.clientX;
      const startY = e.clientY;
      const originW = width;
      const originH = height;
      const originX = x ?? pos.x;
      const originY = y ?? pos.y;
      const el = e.currentTarget;
      el.setPointerCapture?.(e.pointerId);
      let lastW = originW;
      let lastH = originH;
      let lastX = originX;
      let lastY = originY;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let nextW = originW;
        let nextH = originH;
        let nextX = originX;
        let nextY = originY;

        if (mode === "east" || mode === "southeast") {
          const maxW = activeBounds.x + activeBounds.width - originX;
          nextW = Math.max(minWidth, Math.min(maxW, originW + dx));
        }
        if (mode === "west" || mode === "southwest") {
          const maxW = originX + originW - activeBounds.x;
          nextW = Math.max(minWidth, Math.min(maxW, originW - dx));
          nextX = originX + (originW - nextW);
        }
        if (
          mode === "south" ||
          mode === "southeast" ||
          mode === "southwest"
        ) {
          const maxH = activeBounds.y + activeBounds.height - originY;
          nextH = Math.max(minHeight, Math.min(maxH, originH + dy));
        }

        lastW = nextW;
        lastH = nextH;
        setWidth(nextW);
        setHeight(nextH);
        if (nextX !== originX || nextY !== originY) {
          const clamped = clampPos(nextX, nextY, nextW, nextH, activeBounds);
          lastX = clamped.x;
          lastY = clamped.y;
          setX(clamped.x);
          setY(clamped.y);
        } else {
          lastX = nextX;
          lastY = nextY;
        }
      };
      const onUp = (ev: PointerEvent) => {
        try {
          el.releasePointerCapture?.(ev.pointerId);
        } catch {
          /* already released */
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        persistLayout({
          x: lastX,
          y: lastY,
          width: lastW,
          height: lastH,
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      const cursor =
        mode === "east" || mode === "west"
          ? "ew-resize"
          : mode === "south"
            ? "ns-resize"
            : mode === "southwest"
              ? "nesw-resize"
              : "nwse-resize";
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
    },
    [
      maximized,
      isPhone,
      width,
      height,
      x,
      y,
      pos.x,
      pos.y,
      minWidth,
      minHeight,
      persistLayout,
    ]
  );

  if (!open) return null;

  const shadow = isLight
    ? `0 18px 40px -18px rgb(15 23 42 / 0.28), 0 0 0 1px ${accent}40`
    : `0 16px 48px -16px ${accent}99`;

  return (
    <aside
      ref={asideRef}
      aria-hidden={minimized ? true : undefined}
      style={
        minimized
          ? { display: "none" }
          : isPhone
            ? {
                top: "var(--graph-top-chrome-band, 5.625rem)",
                bottom: "var(--graph-composer-band, 7.25rem)",
                borderColor: isLight ? `${accent}40` : `${accent}66`,
              }
            : maximized
              ? {
                  left: bounds.x,
                  top: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                  borderColor: isLight ? `${accent}40` : `${accent}66`,
                }
              : {
                  left: pos.x,
                  top: pos.y,
                  width: currentWidth,
                  height: currentHeight,
                  borderColor: isLight ? `${accent}55` : `${accent}88`,
                  boxShadow: shadow,
                }
      }
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-muted text-foreground shadow-xl",
        isPhone
          ? cn(
              "fixed inset-x-0 rounded-none border-b",
              GRAPH_WINDOW_Z
            )
          : cn("absolute rounded-xl border-2", zIndexClassName),
        className
      )}
      onPointerDownCapture={() => {
        if (windowId) setActiveFloatingWindow(windowId);
      }}
    >
      {!isPhone && !maximized ? (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize window height"
            title="Drag to resize height"
            onPointerDown={(e) => startResize(e, "south")}
            className="group absolute bottom-0 left-0 z-10 flex h-2 w-full cursor-ns-resize items-center justify-center"
          >
            <span className="h-0.5 w-10 rounded-full bg-border/0 transition-colors group-hover:bg-foreground/50 group-active:bg-foreground/70" />
          </div>
          {/* East edge: primary for left-placed windows (Chat-like). */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize window width from right"
            title="Drag to resize width"
            onPointerDown={(e) => startResize(e, "east")}
            className="group absolute right-0 top-0 z-10 flex h-full w-2 cursor-ew-resize items-center justify-center"
          >
            <span className="h-10 w-0.5 rounded-full bg-border/0 transition-colors group-hover:bg-foreground/50 group-active:bg-foreground/70" />
          </div>
          {/* West edge: primary for right-placed windows (Information). */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize window width from left"
            title="Drag to resize width"
            onPointerDown={(e) => startResize(e, "west")}
            className="group absolute left-0 top-0 z-10 flex h-full w-2 cursor-ew-resize items-center justify-center"
          >
            <span className="h-10 w-0.5 rounded-full bg-border/0 transition-colors group-hover:bg-foreground/50 group-active:bg-foreground/70" />
          </div>
          <div
            role="separator"
            aria-label="Resize window from bottom-right"
            title="Drag to resize"
            onPointerDown={(e) => startResize(e, "southeast")}
            className="absolute bottom-0 right-0 z-20 size-4 cursor-nwse-resize"
          />
          <div
            role="separator"
            aria-label="Resize window from bottom-left"
            title="Drag to resize"
            onPointerDown={(e) => startResize(e, "southwest")}
            className="absolute bottom-0 left-0 z-20 size-4 cursor-nesw-resize"
          />
        </>
      ) : null}

      <div
        className="h-1 w-full shrink-0"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

      <header
        onPointerDown={isPhone || maximized ? undefined : handleDrag}
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 border-b px-2 select-none",
          !isPhone && !maximized && "cursor-move"
        )}
        style={{
          borderColor: `${accent}40`,
          backgroundColor: `${accent}14`,
        }}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate bg-transparent text-sm font-medium text-foreground">
          {title}
        </span>
        {headerActions ? (
          <div data-floating-chrome className="flex shrink-0 items-center gap-1">
            {headerActions}
          </div>
        ) : null}
        {onMinimize ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            data-floating-chrome
            aria-label="Minimize window"
            title="Minimize"
            onClick={onMinimize}
          >
            <MinusIcon />
          </Button>
        ) : null}
        {!isPhone ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            data-floating-chrome
            aria-label={maximized ? "Restore window" : "Maximize window"}
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => setMaximized((m) => !m)}
          >
            {maximized ? <Minimize2Icon /> : <Maximize2Icon />}
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          data-floating-chrome
          aria-label="Close window"
          title="Close"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </aside>
  );
}
