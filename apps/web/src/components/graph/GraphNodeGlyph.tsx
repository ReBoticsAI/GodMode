import {
  memo,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronDownIcon, ChevronRightIcon, HardHatIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  GRAPH_GLYPH_KEYS,
  graphKindColor,
  graphNodeColor,
  resolveGraphGlyphKey,
  type GraphGlyphKey,
} from "@/lib/graph-node-style";

/** Uniform glyph box (CSS + SVG viewBox). Every node uses this size. */
export const GRAPH_GLYPH_PX = 112;

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

type ShapeProps = { color: string; ink: string };

function strokeFill(color: string, alpha = "33") {
  return {
    fill: `${color}${alpha}`,
    stroke: color,
    strokeWidth: 3,
    strokeLinejoin: "round" as const,
  };
}

/**
 * CONSTRAINT: every GraphGlyphKey has a unique SVG silhouette.
 * Missing a key is a TypeScript error.
 */
const GLYPH_ICON: Record<GraphGlyphKey, (props: ShapeProps) => ReactNode> = {
  chat: ({ color }) => (
    <path
      fill="none"
      stroke={color}
      strokeWidth={3.5}
      strokeLinejoin="round"
      d="M18 22h84a14 14 0 0 1 14 14v42a14 14 0 0 1-14 14H52l-18 18v-18H18A14 14 0 0 1 4 78V36a14 14 0 0 1 14-14z"
    />
  ),

  agent: ({ color, ink }) => (
    <g>
      <circle cx="60" cy="12" r="4" fill={color} />
      <line x1="60" y1="16" x2="60" y2="26" stroke={color} strokeWidth={3} strokeLinecap="round" />
      <rect x="22" y="26" width="76" height="54" rx="14" {...strokeFill(color)} />
      <rect x="34" y="86" width="52" height="18" rx="6" {...strokeFill(color)} />
      <rect x="38" y="40" width="16" height="12" rx="3" fill={ink} stroke={color} strokeWidth={2} />
      <rect x="66" y="40" width="16" height="12" rx="3" fill={ink} stroke={color} strokeWidth={2} />
      <line x1="44" y1="66" x2="76" y2="66" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </g>
  ),

  /** Group of three robots — Agents hub (not a single Intelligence-style bot). */
  agents: ({ color, ink }) => {
    const bot = (cx: number, cy: number, s: number) => (
      <g transform={`translate(${cx} ${cy}) scale(${s}) translate(-60 -60)`}>
        <circle cx="60" cy="12" r="4" fill={color} />
        <line
          x1="60"
          y1="16"
          x2="60"
          y2="26"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <rect x="22" y="26" width="76" height="54" rx="14" {...strokeFill(color)} />
        <rect x="34" y="86" width="52" height="18" rx="6" {...strokeFill(color)} />
        <rect
          x="38"
          y="40"
          width="16"
          height="12"
          rx="3"
          fill={ink}
          stroke={color}
          strokeWidth={2}
        />
        <rect
          x="66"
          y="40"
          width="16"
          height="12"
          rx="3"
          fill={ink}
          stroke={color}
          strokeWidth={2}
        />
        <line
          x1="44"
          y1="66"
          x2="76"
          y2="66"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
        />
      </g>
    );
    return (
      <g>
        {bot(30, 40, 0.4)}
        {bot(90, 40, 0.4)}
        {bot(60, 78, 0.48)}
      </g>
    );
  },

  user: ({ color }) => (
    <g>
      <circle cx="60" cy="34" r="20" {...strokeFill(color)} />
      <path {...strokeFill(color)} d="M18 108c0-24 18-40 42-40s42 16 42 40" />
    </g>
  ),

  memory: ({ color }) => (
    <g>
      <ellipse cx="60" cy="28" rx="36" ry="14" {...strokeFill(color)} />
      <path d="M24 28 v52 a36 14 0 0 0 72 0 V28" {...strokeFill(color)} />
      <ellipse cx="60" cy="80" rx="36" ry="14" fill="none" stroke={color} strokeWidth={3} />
      <path d="M24 54 a36 14 0 0 0 72 0" fill="none" stroke={color} strokeWidth={2.5} />
    </g>
  ),

  skill: ({ color }) => (
    <path
      {...strokeFill(color)}
      d="M60 10l14 28h30l-24 20 8 32-28-18-28 18 8-32-24-20h30z"
    />
  ),

  tool: ({ color }) => (
    <g fill={`${color}33`} stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M78 18c-10 0-18 8-18 18 0 2 .3 4 .9 5.8L28 74l-8 8 10 10 8-8 32.2-32.9c1.8.6 3.7.9 5.8.9 10 0 18-8 18-18 0-3-1-6-2.6-8.4L78 48 62 32l12.4-12.4C72 18.8 75 18 78 18z" />
      <circle cx="82" cy="28" r="5" fill={color} stroke="none" />
    </g>
  ),

  /** Package / cube — Artifacts (not the wrench). */
  artifact: ({ color }) => (
    <g>
      <path
        {...strokeFill(color)}
        d="M60 14 L104 38 L104 86 L60 110 L16 86 L16 38 Z"
      />
      <path d="M60 14 V62 L104 38" fill="none" stroke={color} strokeWidth={3} />
      <path d="M60 62 L16 38" fill="none" stroke={color} strokeWidth={3} />
      <path d="M60 62 V110" fill="none" stroke={color} strokeWidth={3} />
    </g>
  ),

  workflow: ({ color }) => (
    <g>
      <path {...strokeFill(color)} d="M60 12 L100 60 L60 108 L20 60 Z" />
      <circle cx="60" cy="36" r="5" fill={color} />
      <circle cx="42" cy="68" r="5" fill={color} />
      <circle cx="78" cy="68" r="5" fill={color} />
      <line x1="60" y1="41" x2="42" y2="63" stroke={color} strokeWidth={2.5} />
      <line x1="60" y1="41" x2="78" y2="63" stroke={color} strokeWidth={2.5} />
    </g>
  ),

  schedule: ({ color }) => (
    <g>
      <rect x="18" y="28" width="84" height="76" rx="10" {...strokeFill(color)} />
      <line x1="18" y1="48" x2="102" y2="48" stroke={color} strokeWidth={3} />
      <line x1="40" y1="16" x2="40" y2="36" stroke={color} strokeWidth={4} strokeLinecap="round" />
      <line x1="80" y1="16" x2="80" y2="36" stroke={color} strokeWidth={4} strokeLinecap="round" />
      <rect x="34" y="58" width="14" height="12" rx="2" fill={color} />
      <rect x="54" y="58" width="14" height="12" rx="2" fill={color} />
      <rect x="74" y="58" width="14" height="12" rx="2" fill={`${color}99`} />
    </g>
  ),

  page: ({ color }) => (
    <g>
      <path
        {...strokeFill(color)}
        d="M30 12h44l28 28v68a10 10 0 0 1-10 10H30a10 10 0 0 1-10-10V22a10 10 0 0 1 10-10z"
      />
      <path fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" d="M74 12v28h28" />
      <line x1="40" y1="64" x2="80" y2="64" stroke={color} strokeWidth={2.5} />
      <line x1="40" y1="78" x2="72" y2="78" stroke={color} strokeWidth={2.5} />
    </g>
  ),

  unlock: ({ color }) => (
    <g>
      <path
        d="M40 54 V40 a20 20 0 0 1 40 0 v14"
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
      />
      <rect x="28" y="54" width="64" height="48" rx="10" {...strokeFill(color)} />
      <circle cx="60" cy="76" r="6" fill={color} />
      <line x1="60" y1="82" x2="60" y2="92" stroke={color} strokeWidth={4} strokeLinecap="round" />
    </g>
  ),

  system: ({ color }) => (
    <g>
      <path {...strokeFill(color)} d="M60 10 L102 34 L102 86 L60 110 L18 86 L18 34 Z" />
      <circle cx="60" cy="60" r="16" fill="none" stroke={color} strokeWidth={3} />
      <circle cx="60" cy="60" r="5" fill={color} />
    </g>
  ),

  /** Safe / vault door — Vault */
  vault: ({ color }) => (
    <g>
      <rect x="18" y="22" width="84" height="80" rx="12" {...strokeFill(color)} />
      <circle cx="60" cy="58" r="22" fill="none" stroke={color} strokeWidth={3} />
      <circle cx="60" cy="58" r="8" fill={color} />
      <line x1="60" y1="36" x2="60" y2="44" stroke={color} strokeWidth={3} strokeLinecap="round" />
      <line x1="60" y1="72" x2="60" y2="80" stroke={color} strokeWidth={3} strokeLinecap="round" />
      <line x1="38" y1="58" x2="46" y2="58" stroke={color} strokeWidth={3} strokeLinecap="round" />
      <line x1="74" y1="58" x2="82" y2="58" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </g>
  ),

  /** Hub / switch glyph for the Bridge connection */
  heart: ({ color }) => (
    <g>
      <circle cx="60" cy="60" r="12" {...strokeFill(color, "66")} />
      <circle cx="24" cy="60" r="8" {...strokeFill(color, "40")} />
      <circle cx="96" cy="60" r="8" {...strokeFill(color, "40")} />
      <circle cx="60" cy="26" r="8" {...strokeFill(color, "40")} />
      <circle cx="60" cy="94" r="8" {...strokeFill(color, "40")} />
      <line x1="36" y1="60" x2="48" y2="60" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
      <line x1="72" y1="60" x2="84" y2="60" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
      <line x1="60" y1="38" x2="60" y2="48" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
      <line x1="60" y1="72" x2="60" y2="82" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
    </g>
  ),

  /** Lifebuoy / headset — Support */
  support: ({ color }) => (
    <g>
      <circle cx="60" cy="56" r="34" {...strokeFill(color)} />
      <circle cx="60" cy="56" r="14" fill="none" stroke={color} strokeWidth={8} />
      <line x1="36" y1="36" x2="48" y2="48" stroke={color} strokeWidth={6} strokeLinecap="round" />
      <line x1="84" y1="36" x2="72" y2="48" stroke={color} strokeWidth={6} strokeLinecap="round" />
      <line x1="36" y1="76" x2="48" y2="64" stroke={color} strokeWidth={6} strokeLinecap="round" />
      <line x1="84" y1="76" x2="72" y2="64" stroke={color} strokeWidth={6} strokeLinecap="round" />
      <path d="M40 96 H80" stroke={color} strokeWidth={4} strokeLinecap="round" />
    </g>
  ),

  /** Linked nodes — Shared */
  shared: ({ color }) => (
    <g>
      <circle cx="36" cy="40" r="14" {...strokeFill(color)} />
      <circle cx="84" cy="40" r="14" {...strokeFill(color)} />
      <circle cx="60" cy="84" r="14" {...strokeFill(color)} />
      <line x1="48" y1="48" x2="72" y2="48" stroke={color} strokeWidth={3} />
      <line x1="44" y1="52" x2="54" y2="72" stroke={color} strokeWidth={3} />
      <line x1="76" y1="52" x2="66" y2="72" stroke={color} strokeWidth={3} />
    </g>
  ),

  /** Storefront — Marketplace */
  marketplace: ({ color }) => (
    <g>
      <path {...strokeFill(color)} d="M20 48 L28 28 H92 L100 48 Z" />
      <rect x="24" y="48" width="72" height="52" rx="4" {...strokeFill(color)} />
      <rect x="48" y="64" width="24" height="36" rx="2" fill={`${color}66`} stroke={color} strokeWidth={2} />
      <line x1="20" y1="48" x2="100" y2="48" stroke={color} strokeWidth={3} />
    </g>
  ),

  /** Building / folders — Workspace */
  workspace: ({ color }) => (
    <g>
      <rect x="22" y="28" width="76" height="76" rx="6" {...strokeFill(color)} />
      <rect x="34" y="40" width="16" height="14" rx="2" fill={color} />
      <rect x="70" y="40" width="16" height="14" rx="2" fill={color} />
      <rect x="34" y="66" width="16" height="14" rx="2" fill={color} />
      <rect x="70" y="66" width="16" height="14" rx="2" fill={`${color}99`} />
      <rect x="52" y="78" width="16" height="26" rx="2" fill={`${color}66`} stroke={color} strokeWidth={2} />
    </g>
  ),

  /** Coins — Bank */
  bank: ({ color }) => (
    <g>
      <ellipse cx="60" cy="78" rx="34" ry="16" {...strokeFill(color)} />
      <ellipse cx="60" cy="58" rx="34" ry="16" {...strokeFill(color)} />
      <ellipse cx="60" cy="38" rx="34" ry="16" {...strokeFill(color, "55")} />
      <path d="M26 38 V78" fill="none" stroke={color} strokeWidth={3} />
      <path d="M94 38 V78" fill="none" stroke={color} strokeWidth={3} />
    </g>
  ),

  /** Layer stack — Structure */
  structure: ({ color }) => (
    <g>
      <path {...strokeFill(color)} d="M60 18 L100 40 L60 62 L20 40 Z" />
      <path {...strokeFill(color)} d="M20 52 L60 74 L100 52" fill="none" />
      <path {...strokeFill(color)} d="M20 66 L60 88 L100 66" fill="none" />
      <path d="M20 52 L20 66 L60 88 L100 66 L100 52 L60 74 Z" {...strokeFill(color, "22")} />
    </g>
  ),

  /** Org columns — Departments */
  departments: ({ color }) => (
    <g>
      <rect x="16" y="24" width="26" height="72" rx="4" {...strokeFill(color)} />
      <rect x="47" y="24" width="26" height="72" rx="4" {...strokeFill(color)} />
      <rect x="78" y="24" width="26" height="72" rx="4" {...strokeFill(color)} />
      <line x1="20" y1="40" x2="38" y2="40" stroke={color} strokeWidth={2} />
      <line x1="51" y1="40" x2="69" y2="40" stroke={color} strokeWidth={2} />
      <line x1="82" y1="40" x2="100" y2="40" stroke={color} strokeWidth={2} />
    </g>
  ),

  /** Split panes — Divisions */
  divisions: ({ color }) => (
    <g>
      <rect x="16" y="22" width="88" height="76" rx="8" {...strokeFill(color)} />
      <line x1="60" y1="22" x2="60" y2="98" stroke={color} strokeWidth={4} />
      <line x1="16" y1="60" x2="104" y2="60" stroke={color} strokeWidth={3} />
    </g>
  ),

  /** Open book — Wiki */
  wiki: ({ color }) => (
    <g>
      <path {...strokeFill(color)} d="M60 28 C44 20 22 24 18 30 V94 C28 86 48 86 60 94 C72 86 92 86 102 94 V30 C98 24 76 20 60 28 Z" />
      <line x1="60" y1="28" x2="60" y2="94" stroke={color} strokeWidth={3} />
    </g>
  ),

  /** Scroll / gavel mark — Rules */
  rule: ({ color }) => (
    <g>
      <rect x="30" y="18" width="60" height="84" rx="8" {...strokeFill(color)} />
      <line x1="42" y1="40" x2="78" y2="40" stroke={color} strokeWidth={3} />
      <line x1="42" y1="56" x2="78" y2="56" stroke={color} strokeWidth={3} />
      <line x1="42" y1="72" x2="66" y2="72" stroke={color} strokeWidth={3} />
      <circle cx="60" cy="18" r="6" fill={color} />
    </g>
  ),

  /** Hook / link — Hooks */
  hook: ({ color }) => (
    <g fill="none" stroke={color} strokeWidth={5} strokeLinecap="round">
      <path d="M40 28 H70 A22 22 0 0 1 70 72 H52" />
      <path d="M52 72 A14 14 0 1 0 52 100" />
      <circle cx="40" cy="28" r="5" fill={color} stroke="none" />
    </g>
  ),

  /** Checkbox — Tasks */
  task: ({ color }) => (
    <g>
      <rect x="22" y="22" width="76" height="76" rx="12" {...strokeFill(color)} />
      <path
        d="M38 62 L52 76 L84 42"
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  ),

  /** Brain / orb — Knowledge */
  knowledge: ({ color }) => (
    <g>
      <circle cx="60" cy="58" r="36" {...strokeFill(color)} />
      <path d="M40 50 C48 38 72 38 80 50" fill="none" stroke={color} strokeWidth={3} />
      <path d="M36 66 C46 78 74 78 84 66" fill="none" stroke={color} strokeWidth={3} />
      <circle cx="48" cy="56" r="4" fill={color} />
      <circle cx="72" cy="56" r="4" fill={color} />
    </g>
  ),

  /** Gear nodes — Automations */
  automations: ({ color }) => (
    <g>
      <circle cx="60" cy="60" r="28" {...strokeFill(color)} />
      <circle cx="60" cy="60" r="10" fill="none" stroke={color} strokeWidth={3} />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const r = (deg * Math.PI) / 180;
        const x1 = 60 + Math.cos(r) * 28;
        const y1 = 60 + Math.sin(r) * 28;
        const x2 = 60 + Math.cos(r) * 40;
        const y2 = 60 + Math.sin(r) * 40;
        return (
          <line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth={6}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  ),

  calendar: ({ color }) => (
    <g>
      <rect x="18" y="28" width="84" height="76" rx="10" {...strokeFill(color)} />
      <line x1="18" y1="48" x2="102" y2="48" stroke={color} strokeWidth={3} />
      <line x1="40" y1="16" x2="40" y2="36" stroke={color} strokeWidth={4} strokeLinecap="round" />
      <line x1="80" y1="16" x2="80" y2="36" stroke={color} strokeWidth={4} strokeLinecap="round" />
      <circle cx="44" cy="68" r="6" fill={color} />
      <circle cx="60" cy="68" r="6" fill={color} />
      <circle cx="76" cy="68" r="6" fill={`${color}99`} />
    </g>
  ),

  /** Bundle — Packs */
  pack: ({ color }) => (
    <g>
      <rect x="24" y="36" width="72" height="60" rx="8" {...strokeFill(color)} />
      <path {...strokeFill(color)} d="M24 48 H96 L84 36 H36 Z" />
      <line x1="60" y1="36" x2="60" y2="96" stroke={color} strokeWidth={3} />
    </g>
  ),

  /** Plug — Connectors */
  connector: ({ color }) => (
    <g>
      <rect x="44" y="16" width="32" height="28" rx="4" {...strokeFill(color)} />
      <rect x="36" y="44" width="48" height="36" rx="8" {...strokeFill(color)} />
      <line x1="52" y1="80" x2="52" y2="104" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <line x1="68" y1="80" x2="68" y2="104" stroke={color} strokeWidth={5} strokeLinecap="round" />
    </g>
  ),

  /** Ticket stub — Tickets */
  tickets: ({ color }) => (
    <g>
      <path
        {...strokeFill(color)}
        d="M18 40 H70 A12 12 0 0 0 70 64 H18 A10 10 0 0 1 18 40 Z"
      />
      <path
        {...strokeFill(color)}
        d="M50 56 H102 A10 10 0 0 1 102 80 H50 A12 12 0 0 0 50 56 Z"
      />
      <line x1="34" y1="48" x2="34" y2="56" stroke={color} strokeWidth={2} strokeDasharray="3 3" />
      <line x1="84" y1="64" x2="84" y2="72" stroke={color} strokeWidth={2} strokeDasharray="3 3" />
    </g>
  ),

  /** Globe arcs — Network */
  network: ({ color }) => (
    <g fill="none" stroke={color} strokeWidth={3}>
      <circle cx="60" cy="60" r="36" {...strokeFill(color, "22")} />
      <ellipse cx="60" cy="60" rx="18" ry="36" />
      <line x1="24" y1="60" x2="96" y2="60" />
      <path d="M28 42 H92" />
      <path d="M28 78 H92" />
    </g>
  ),

  /** Key handoff — Grants */
  grants: ({ color }) => (
    <g>
      <circle cx="40" cy="48" r="16" {...strokeFill(color)} />
      <path
        d="M52 48 H88"
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path
        d="M88 48 V68 M88 58 H98"
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
      />
      <circle cx="40" cy="48" r="5" fill={color} />
    </g>
  ),
};

// Exhaustive coverage check (compile-time + runtime presence).
const _glyphCoverage: Record<GraphGlyphKey, true> = Object.fromEntries(
  GRAPH_GLYPH_KEYS.map((k) => [k, true])
) as Record<GraphGlyphKey, true>;
void _glyphCoverage;

function GlyphShape({
  glyph,
  color,
  ink,
}: {
  glyph: GraphGlyphKey;
  color: string;
  ink: string;
}) {
  return <>{GLYPH_ICON[glyph]({ color, ink })}</>;
}

function textAnchorY(glyph: GraphGlyphKey): number {
  switch (glyph) {
    case "chat":
      return 56;
    case "agent":
      return 72;
    case "agents":
      return 108;
    case "user":
      return 92;
    case "schedule":
    case "calendar":
      return 88;
    case "tool":
      return 100;
    case "page":
      return 88;
    case "memory":
    case "knowledge":
      return 56;
    case "unlock":
    case "vault":
      return 100;
    case "workflow":
    case "automations":
      return 100;
    case "system":
    case "heart":
      return 88;
    case "artifact":
      return 64;
    default:
      return 64;
  }
}

function GraphNodeGlyphInner({
  kind,
  label,
  nodeId,
  objectType,
  color: colorOverride,
  selected,
  adjacent,
  muted,
  attention,
  working,
  collapsible,
  collapsed,
  onToggleCollapse,
  className,
  ...buttonProps
}: {
  kind: string;
  label: string;
  nodeId?: string;
  objectType?: string | null;
  color?: string;
  selected?: boolean;
  adjacent?: boolean;
  muted?: boolean;
  attention?: boolean;
  /** Active work: running turn, in-progress card, or open workflow. */
  working?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const glyph = resolveGraphGlyphKey({
    kind,
    objectType,
    id: nodeId,
    label,
  });
  const color =
    colorOverride ??
    (nodeId
      ? graphNodeColor(kind, nodeId, null, objectType, label)
      : graphKindColor(kind));
  const ink = isLight ? "#f4f4f5" : "#0a0a0b";
  const labelFill = isLight ? "#0f172a" : "#f8fafc";
  const labelStroke = isLight ? "#f8fafc" : "#0a0a0b";
  const display = fitLabel(label, 18);
  const fontSize = labelFontSize(display);
  const ty = textAnchorY(glyph);
  // CSS filter:drop-shadow on every glyph is a major paint cost under Html
  // overlays (recomposited on every camera move). Prefer a cheap SVG ring.
  const ring =
    selected || adjacent ? (
      <circle
        cx="60"
        cy="60"
        r="56"
        fill="none"
        stroke={color}
        strokeWidth={selected ? 4 : 2.5}
        opacity={selected ? 0.95 : 0.55}
      />
    ) : null;

  return (
    <div
      className="relative shrink-0"
      style={{ width: GRAPH_GLYPH_PX, height: GRAPH_GLYPH_PX }}
    >
      <button
        type="button"
        className={cn(
          "relative block size-full cursor-pointer border-0 bg-transparent p-0 outline-none",
          selected ? "scale-110" : null,
          muted ? "opacity-70" : "opacity-100",
          className
        )}
        {...buttonProps}
      >
        <svg
          width={GRAPH_GLYPH_PX}
          height={GRAPH_GLYPH_PX}
          viewBox="0 0 120 120"
          aria-hidden
          className="pointer-events-none block"
        >
          {ring}
          <GlyphShape glyph={glyph} color={color} ink={ink} />
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
        {working ? (
          <span
            className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border border-border/80 bg-secondary text-secondary-foreground shadow-sm"
            title="In progress"
            aria-hidden
          >
            <HardHatIcon className="size-3.5" />
          </span>
        ) : null}
        {attention ? (
          <span
            className="absolute right-2 top-2 size-3 rounded-full bg-destructive ring-2 ring-background"
            aria-hidden
          />
        ) : null}
        <span className="sr-only">
          {kind}: {label}
          {working ? " (in progress)" : ""}
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

/** Memoized: parent Html LOD swaps should not redraw unchanged glyphs. */
export const GraphNodeGlyph = memo(GraphNodeGlyphInner);

export { graphKindColor, graphNodeColor } from "@/lib/graph-node-style";
