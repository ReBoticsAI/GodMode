import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AgentPulseIconProps = {
  /** When true the pulse runs faster and brighter (e.g. chat open with this agent). */
  active?: boolean;
  /** When false, children render without animation. */
  pulse?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Wraps a sidebar icon (lucide or emoji) with the same grow/shrink pulse used
 * by the Intelligence robot icon.
 */
export function AgentPulseIcon({
  active = false,
  pulse = true,
  className,
  children,
}: AgentPulseIconProps) {
  if (!pulse) {
    return <span className={cn("inline-flex shrink-0 items-center justify-center", className)}>{children}</span>;
  }

  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)}>
      <span
        className={cn("agent-pulse-icon inline-flex items-center justify-center", active && "agent-pulse-icon--active")}
      >
        {children}
      </span>
      <style>{`
        .agent-pulse-icon {
          display: inline-flex;
          transform-origin: center;
          animation: agent-pulse-icon-keyframes 2.4s ease-in-out infinite;
        }
        .agent-pulse-icon--active {
          animation-duration: 1.2s;
          filter: drop-shadow(0 0 5px rgba(251, 191, 36, 0.55));
        }
        @keyframes agent-pulse-icon-keyframes {
          0% { transform: scale(0.82); }
          50% { transform: scale(1.22); }
          100% { transform: scale(0.82); }
        }
      `}</style>
    </span>
  );
}
