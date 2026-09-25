import { useEffect, useState } from "react";
import { getFloatingWindowBounds } from "@/lib/floating-window-bounds";
import {
  GRID_CELL_PX,
  cellLabel,
  defaultFocusAxisX,
  gridExtents,
  windowCornerBlocks,
  type GridRect,
} from "@/lib/floating-window-grid";
import {
  listFloatingWindows,
  subscribeFloatingWindowRegistry,
} from "@/lib/floating-window-registry";
import { cn } from "@/lib/utils";

/**
 * Full XY block underlayment for the content area.
 * Shows column/row axes, cell lines, focus axis, and live window corner blocks.
 */
export function WindowAnchorGridOverlay({
  open,
  anchorPickMode = false,
}: {
  open: boolean;
  anchorPickMode?: boolean;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    const recompute = () => setTick((n) => n + 1);
    recompute();
    window.addEventListener("resize", recompute);
    const unsub = subscribeFloatingWindowRegistry(recompute);
    const main = document.querySelector("main");
    const observer = main ? new ResizeObserver(recompute) : null;
    if (main && observer) observer.observe(main);
    const interval = window.setInterval(recompute, 250);
    return () => {
      window.removeEventListener("resize", recompute);
      unsub();
      observer?.disconnect();
      window.clearInterval(interval);
    };
  }, [open]);

  if (!open) return null;

  void tick;
  const bounds = getFloatingWindowBounds();
  const { cols, rows } = gridExtents(bounds);
  const focusX = defaultFocusAxisX(bounds);
  const windows = listFloatingWindows()
    .map((reg) => {
      const layout = reg.getLayout();
      if (!layout) return null;
      return { id: reg.id, role: reg.role, layout, corners: windowCornerBlocks(layout, bounds) };
    })
    .filter(Boolean) as Array<{
    id: string;
    role: string;
    layout: GridRect;
    corners: ReturnType<typeof windowCornerBlocks>;
  }>;

  const vLines = Array.from({ length: cols + 1 }, (_, i) => i);
  const hLines = Array.from({ length: rows + 1 }, (_, i) => i);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-20 overflow-hidden",
        anchorPickMode && "ring-2 ring-inset ring-primary/40"
      )}
      aria-hidden
    >
      <div
        className="absolute"
        style={{
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
        }}
      >
        {/* Vertical grid lines + column letters */}
        {vLines.map((i) => (
          <div
            key={`v-${i}`}
            className={cn(
              "absolute top-0 h-full border-l",
              i % 5 === 0 ? "border-border/70" : "border-border/30"
            )}
            style={{ left: i * GRID_CELL_PX }}
          >
            {i < cols ? (
              <span className="absolute left-0.5 top-0.5 text-[9px] font-medium text-muted-foreground/80">
                {cellLabel(i, 0).replace(/\d+$/, "")}
              </span>
            ) : null}
          </div>
        ))}
        {/* Horizontal grid lines + row numbers */}
        {hLines.map((i) => (
          <div
            key={`h-${i}`}
            className={cn(
              "absolute left-0 w-full border-t",
              i % 5 === 0 ? "border-border/70" : "border-border/30"
            )}
            style={{ top: i * GRID_CELL_PX }}
          >
            {i < rows ? (
              <span className="absolute left-0.5 top-0.5 text-[9px] font-medium text-muted-foreground/80">
                {i + 1}
              </span>
            ) : null}
          </div>
        ))}

        {/* Focus-node vertical axis (mirror line) */}
        <div
          className="absolute top-0 h-full w-px bg-primary/70"
          style={{ left: focusX - bounds.x }}
        >
          <span className="absolute left-1 top-2 whitespace-nowrap rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            Focus node
          </span>
        </div>

        {/* Window footprints + corner block labels */}
        {windows.map((w) => (
          <div key={w.id} className="absolute" style={{
            left: w.layout.x - bounds.x,
            top: w.layout.y - bounds.y,
            width: w.layout.width,
            height: w.layout.height,
          }}>
            <div className="absolute inset-0 rounded-md border border-primary/35 bg-primary/5" />
            {(
              [
                ["b1", w.corners.b1, "left-1 top-1"],
                ["b2", w.corners.b2, "right-1 top-1"],
                ["b3", w.corners.b3, "bottom-1 left-1"],
                ["b4", w.corners.b4, "bottom-1 right-1"],
              ] as const
            ).map(([key, corner, pos]) => (
              <span
                key={key}
                className={cn(
                  "absolute rounded bg-background/90 px-1 py-0.5 font-mono text-[9px] font-semibold text-foreground shadow-sm",
                  pos
                )}
                title={`${w.role} ${corner.label}`}
              >
                {corner.label}
              </span>
            ))}
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {w.role}
            </span>
          </div>
        ))}
      </div>

      {anchorPickMode ? (
        <div className="absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-md border border-primary/40 bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md">
          Click a window to Anchor. Its pair mirrors across the focus node.
        </div>
      ) : null}
    </div>
  );
}
