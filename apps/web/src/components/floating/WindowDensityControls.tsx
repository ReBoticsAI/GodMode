import { useEffect, useState } from "react";
import { ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  bumpWindowDensity,
  getWindowDensity,
  WINDOW_DENSITY_EVENT,
  WINDOW_DENSITY_MAX,
  WINDOW_DENSITY_MIN,
  WINDOW_DENSITY_STEP,
} from "@/lib/floating-window-density";

/**
 * Title-bar density controls for one floating window.
 * Zoom out packs more UI into the frame; zoom in enlarges text and controls.
 * Uses zoom icons (not +/−) so Social new-chat and Minimize stay unambiguous.
 */
export function WindowDensityControls({
  windowId,
  size = "icon-sm",
}: {
  windowId: string;
  size?: "icon-xs" | "icon-sm";
}) {
  const [density, setDensity] = useState(() => getWindowDensity(windowId));

  useEffect(() => {
    setDensity(getWindowDensity(windowId));
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<{ windowId?: string; density?: number }>)
        .detail;
      if (detail?.windowId !== windowId) return;
      if (typeof detail.density === "number") setDensity(detail.density);
      else setDensity(getWindowDensity(windowId));
    };
    window.addEventListener(WINDOW_DENSITY_EVENT, onChange);
    return () => window.removeEventListener(WINDOW_DENSITY_EVENT, onChange);
  }, [windowId]);

  if (!windowId.trim()) return null;

  const pct = Math.round(density * 100);

  return (
    <div
      data-floating-chrome
      className="flex shrink-0 items-center gap-0.5"
      title={`Content density ${pct}%`}
    >
      <Button
        type="button"
        size={size}
        variant="ghost"
        data-floating-chrome
        aria-label="Decrease content density"
        title={`Smaller content (${pct}%)`}
        disabled={density <= WINDOW_DENSITY_MIN + 1e-9}
        onClick={() =>
          setDensity(bumpWindowDensity(windowId, -WINDOW_DENSITY_STEP))
        }
      >
        <ZoomOutIcon />
      </Button>
      <Button
        type="button"
        size={size}
        variant="ghost"
        data-floating-chrome
        aria-label="Increase content density"
        title={`Larger content (${pct}%)`}
        disabled={density >= WINDOW_DENSITY_MAX - 1e-9}
        onClick={() =>
          setDensity(bumpWindowDensity(windowId, WINDOW_DENSITY_STEP))
        }
      >
        <ZoomInIcon />
      </Button>
    </div>
  );
}
