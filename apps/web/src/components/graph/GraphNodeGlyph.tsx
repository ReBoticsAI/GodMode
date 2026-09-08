import type { ButtonHTMLAttributes } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Uniform glyph box (CSS + SVG viewBox). Every node uses this size. */
export const GRAPH_GLYPH_PX = 112;

const KIND_COLOR: Record<string, string> = {
  chat: "#38bdf8",
  agent: "#a78bfa",
  user: "#34d399",
  memory: "#fbbf24",
  skill: "#fb7185",
  tool: "#94a3b8",
  workflow: "#f472b6",
  schedule: "#2dd4bf",
  page: "#60a5fa",
  unlock: "#eab308",
  system: "#a8a29e",
};

function fitLabel(label: string, maxChars: number): string {
  const t = label.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(1, maxChars - 1))}…`;
}

function labelFontSize(label: string): number {
  const n = label.length;
  if (n <= 8) return 13;
  if (n <= 12) return 11;
  if (n <= 16) return 10;
  return 9;
}

/** Kind-specific silhouette paths in a shared 120×120 viewBox. */
function GlyphShape({
  kind,
  color,
  ink,
}: {
  kind: string;
  color: string;
  ink: string;
}) {
  const fill = `${color}33`;
  const stroke = color;
  const common = {
    fill,
    stroke,
    strokeWidth: 3,
    strokeLinejoin: "round" as const,
  };

  switch (kind) {
    case "chat":
      // Large speech bubble; label sits in the body.
      return (
        <path
          {...common}
          d="M18 22h84a14 14 0 0 1 14 14v42a14 14 0 0 1-14 14H52l-18 18v-18H18A14 14 0 0 1 4 78V36a14 14 0 0 1 14-14z"
        />
      );
    case "agent":
      // Robot head + antenna + body plate for text.
      return (
        <g>
          <circle cx="60" cy="14" r="4" fill={stroke} stroke="none" />
          <line
            x1="60"
            y1="18"
            x2="60"
            y2="28"
            stroke={stroke}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <rect x="22" y="28" width="76" height="52" rx="14" {...common} />
          <rect x="34" y="86" width="52" height="18" rx="6" {...common} />
          <circle cx="44" cy="48" r="5" fill={stroke} stroke="none" />
          <circle cx="76" cy="48" r="5" fill={stroke} stroke="none" />
        </g>
      );
    case "user":
      return (
        <g>
          <circle cx="60" cy="36" r="18" {...common} />
          <path
            {...common}
            d="M22 104c0-22 17-36 38-36s38 14 38 36"
          />
        </g>
      );
    case "unlock":
      return (
        <path
          {...common}
          d="M60 8 L108 36 L108 84 L60 112 L12 84 L12 36 Z"
        />
      );
    case "system":
      return (
        <path
          {...common}
          d="M60 10 L102 34 L102 86 L60 110 L18 86 L18 34 Z"
        />
      );
    case "workflow":
      return (
        <path
          {...common}
          d="M28 20 H92 L108 60 L92 100 H28 L12 60 Z"
        />
      );
    case "schedule":
      return (
        <g>
          <rect x="18" y="28" width="84" height="76" rx="10" {...common} />
          <line
            x1="18"
            y1="48"
            x2="102"
            y2="48"
            stroke={stroke}
            strokeWidth={3}
          />
          <line
            x1="40"
            y1="18"
            x2="40"
            y2="36"
            stroke={stroke}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <line
            x1="80"
            y1="18"
            x2="80"
            y2="36"
            stroke={stroke}
            strokeWidth={4}
            strokeLinecap="round"
          />
        </g>
      );
    case "page":
      return (
        <path
          {...common}
          d="M30 12h44l28 28v68a10 10 0 0 1-10 10H30a10 10 0 0 1-10-10V22a10 10 0 0 1 10-10z"
        />
      );
    case "memory":
      return (
        <ellipse cx="60" cy="60" rx="48" ry="40" {...common} />
      );
    case "skill":
      return (
        <path
          {...common}
          d="M60 12l12 28h30l-24 20 8 30-26-16-26 16 8-30-24-20h30z"
        />
      );
    case "tool":
      return (
        <g>
          <circle cx="60" cy="60" r="42" {...common} />
          <circle cx="60" cy="60" r="14" fill={ink} stroke={stroke} strokeWidth={3} />
        </g>
      );
    default:
      return (
        <rect x="16" y="16" width="88" height="88" rx="22" {...common} />
      );
  }
}

function textAnchorY(kind: string): number {
  switch (kind) {
    case "chat":
      return 56;
    case "agent":
      return 68;
    case "user":
      return 90;
    case "schedule":
      return 74;
    case "tool":
      return 98;
    case "page":
      return 70;
    default:
      return 64;
  }
}

export function GraphNodeGlyph({
  kind,
  label,
  selected,
  adjacent,
  muted,
  attention,
  collapsible,
  collapsed,
  onToggleCollapse,
  className,
  ...buttonProps
}: {
  kind: string;
  label: string;
  selected?: boolean;
  adjacent?: boolean;
  muted?: boolean;
  /** Mission attention notification dot. */
  attention?: boolean;
  /** When true, show an expand/collapse control (node has children). */
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const color = KIND_COLOR[kind] ?? "#94a3b8";
  const ink = isLight ? "#f4f4f5" : "#0a0a0b";
  const labelFill = isLight ? "#0f172a" : "#f8fafc";
  const labelStroke = isLight ? "#f8fafc" : "#0a0a0b";
  const display = fitLabel(label, 18);
  const fontSize = labelFontSize(display);
  const ty = textAnchorY(kind);
  const glow = selected
    ? isLight
      ? `drop-shadow(0 2px 10px ${color}66)`
      : `drop-shadow(0 0 12px ${color}cc)`
    : adjacent
      ? isLight
        ? `drop-shadow(0 2px 8px ${color}44)`
        : `drop-shadow(0 0 8px ${color}88)`
      : isLight
        ? `drop-shadow(0 4px 10px rgb(15 23 42 / 0.18))`
        : `drop-shadow(0 6px 14px ${color}55)`;

  return (
    <div
      className="relative shrink-0"
      style={{ width: GRAPH_GLYPH_PX, height: GRAPH_GLYPH_PX }}
    >
      <button
        type="button"
        className={cn(
          "relative block size-full cursor-pointer border-0 bg-transparent p-0 outline-none transition-transform",
          selected ? "scale-110" : "hover:scale-105",
          muted ? "opacity-75" : "opacity-100",
          className
        )}
        style={{ filter: glow }}
        {...buttonProps}
      >
        <svg
          width={GRAPH_GLYPH_PX}
          height={GRAPH_GLYPH_PX}
          viewBox="0 0 120 120"
          aria-hidden
          className="pointer-events-none block"
        >
          <GlyphShape kind={kind} color={color} ink={ink} />
          <text
            x="60"
            y={ty}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={labelFill}
            fontSize={fontSize}
            fontWeight={600}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            style={{
              paintOrder: "stroke",
              stroke: labelStroke,
              strokeWidth: 3,
            }}
          >
            {display}
          </text>
        </svg>
        {attention ? (
          <span
            className="absolute right-2 top-2 size-3 rounded-full bg-destructive ring-2 ring-background"
            aria-hidden
          />
        ) : null}
        <span className="sr-only">
          {kind}: {label}
          {attention ? " (needs attention)" : ""}
          {collapsible
            ? collapsed
              ? " (collapsed)"
              : " (expanded)"
            : ""}
        </span>
      </button>
      {collapsible ? (
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="absolute -right-1 -bottom-1 size-7 rounded-full border border-border/80 shadow-sm"
          aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          aria-pressed={collapsed}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onToggleCollapse?.();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </Button>
      ) : null}
    </div>
  );
}

export function graphKindColor(kind: string): string {
  return KIND_COLOR[kind] ?? "#94a3b8";
}
