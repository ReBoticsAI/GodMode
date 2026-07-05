import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  AtSignIcon,
  BotIcon,
  CpuIcon,
  FileTextIcon,
  HistoryIcon,
  IdCardIcon,
  KeyRoundIcon,
  LayersIcon,
  MessageSquareIcon,
  ScrollTextIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  UserCircleIcon,
  WrenchIcon,
  ZapIcon,
  ServerIcon,
  UsersIcon,
  RocketIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BuilderNodeData, BuilderNodeKind } from "../graph";

const ICONS: Record<BuilderNodeKind, React.ComponentType<{ className?: string }>> = {
  model: CpuIcon,
  generation: SlidersHorizontalIcon,
  thinking: BotIcon,
  adapters: LayersIcon,
  training: RocketIcon,
  toolMode: WrenchIcon,
  backend: ServerIcon,
  delegation: UsersIcon,
  account: KeyRoundIcon,
  permissions: ShieldIcon,
  profile: IdCardIcon,
  user: UserCircleIcon,
  base: FileTextIcon,
  rules: ScrollTextIcon,
  memory: BotIcon,
  skills: LayersIcon,
  tools: WrenchIcon,
  platform: MessageSquareIcon,
  mentions: AtSignIcon,
  chatHistory: HistoryIcon,
  userMessage: MessageSquareIcon,
  commands: TerminalIcon,
  final: ZapIcon,
};

const GROUP_ACCENT: Record<BuilderNodeData["group"], string> = {
  runtime: "border-sky-500/40",
  prompt: "border-primary/40",
  context: "border-violet-500/40",
  turn: "border-amber-500/40",
  reference: "border-border/60",
  output: "border-emerald-500/50",
};

export function BuilderNode({ data, selected }: NodeProps) {
  const d = data as BuilderNodeData;
  const Icon = ICONS[d.kind] ?? BotIcon;
  return (
    <div
      className={cn(
        "min-w-[170px] max-w-[210px] rounded-lg border bg-card px-2.5 py-2 shadow-sm transition-shadow",
        GROUP_ACCENT[d.group],
        selected && "ring-2 ring-primary",
        d.isSection && !d.enabled && "opacity-45"
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2" />
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-semibold">{d.label}</span>
        {d.isSection && (
          <span
            className={cn(
              "ml-auto size-1.5 shrink-0 rounded-full",
              d.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
          />
        )}
      </div>
      <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
        {d.summary || "—"}
      </div>
      <Handle type="source" position={Position.Right} className="!size-2" />
    </div>
  );
}
