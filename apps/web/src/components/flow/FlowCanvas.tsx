import type { ReactNode } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type ReactFlowProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";

export type FlowCanvasProps = ReactFlowProps & {
  /** Toolbar buttons rendered in the top-right of the canvas (Tidy, Refresh, etc.). */
  actions?: ReactNode;
  backgroundGap?: number;
  showMiniMap?: boolean;
  showControls?: boolean;
  showBackground?: boolean;
};

/**
 * Shared React Flow canvas chrome used across Pipeline, Structure, and Automations.
 * Domain plugins may reuse this shell for their graph editors.
 */
export function FlowCanvas({
  actions,
  backgroundGap = 16,
  showMiniMap = true,
  showControls = true,
  showBackground = true,
  fitView = true,
  className,
  children,
  ...flowProps
}: FlowCanvasProps) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {actions ? (
        <div className="absolute right-3 top-3 z-10 flex flex-wrap justify-end gap-2">
          {actions}
        </div>
      ) : null}
      <ReactFlow
        fitView={fitView}
        className={cn("bg-background", className)}
        {...flowProps}
      >
        {showBackground ? <Background gap={backgroundGap} /> : null}
        {showControls ? (
          <Controls className="!bg-card !border-border [&>button]:!bg-card [&>button]:!border-border [&>button]:!fill-foreground" />
        ) : null}
        {showMiniMap ? (
          <MiniMap
            zoomable
            pannable
            className="!bg-card"
            nodeColor="hsl(var(--muted-foreground))"
            maskColor="hsl(var(--background) / 0.6)"
          />
        ) : null}
        {children}
      </ReactFlow>
    </div>
  );
}
