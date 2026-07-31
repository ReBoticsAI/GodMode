import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BellIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  LandmarkIcon,
  LifeBuoyIcon,
  ListChecksIcon,
  VaultIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useIntelligence, type PanelTab } from "@/lib/intelligence-context";
import { AGENTS_PATH } from "@/lib/navigation";
import { NavBadge } from "@/components/NavBadge";
import { cn } from "@/lib/utils";

/**
 * An AI agent's sidebar group, mirroring the user's personal group. The header
 * opens the chat panel with this agent selected; the tabs open the panel on the
 * matching tab for the same agent. Used for both the user's "Digital <name>"
 * twin and the built-in Intelligence assistant.
 */
const AGENT_ITEMS: ReadonlyArray<{
  tab: PanelTab;
  label: string;
  Icon: LucideIcon;
}> = [
  { tab: "notifications", label: "Notifications", Icon: BellIcon },
  { tab: "calendar", label: "Calendar", Icon: CalendarDaysIcon },
  { tab: "projects", label: "Automations", Icon: ListChecksIcon },
  { tab: "bank", label: "Bank", Icon: LandmarkIcon },
  { tab: "vault", label: "Vault", Icon: VaultIcon },
  { tab: "support", label: "Support", Icon: LifeBuoyIcon },
];

export function AgentGroup({
  agentId,
  label,
  Icon,
  onNavigate,
}: {
  agentId: string;
  label: string;
  Icon: LucideIcon;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const {
    panelOpen,
    panelTab,
    activeAgentId,
    openPanel,
    setAgentsSection,
    reviewUnread,
    notificationsUnread,
  } = useIntelligence();

  const isCurrentAgent = panelOpen && activeAgentId === agentId;
  const headerActive = isCurrentAgent && panelTab === "chat";

  // Collapsed by default; auto-expand only while this agent is the selected one.
  const isSelectedAgent = activeAgentId === agentId;
  const [open, setOpen] = useState(isSelectedAgent);
  useEffect(() => {
    setOpen(isSelectedAgent);
  }, [isSelectedAgent]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="flex flex-col gap-0.5 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 p-1.5"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            openPanel({ tab: "chat", agentId });
            setAgentsSection("pipeline");
            navigate(`${AGENTS_PATH}?section=pipeline&node=profile`);
            onNavigate?.();
          }}
          aria-label={`Open ${label}`}
          title={`Chat with ${label} and open its Agent Profile`}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-base font-bold leading-none tracking-tight transition-colors",
            headerActive
              ? "text-sidebar-accent-foreground"
              : "text-foreground hover:text-sidebar-accent-foreground"
          )}
        >
          <Icon className="size-5 shrink-0 text-sidebar-accent-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        </button>
        <CollapsibleTrigger
          aria-label={`Collapse ${label}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground [&[data-state=open]>svg]:rotate-90"
        >
          <ChevronRightIcon className="size-4 transition-transform duration-200" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="flex flex-col gap-0.5">
        {AGENT_ITEMS.map(({ tab, label: itemLabel, Icon: ItemIcon }) => {
          const active = isCurrentAgent && panelTab === tab;
          const badge =
            tab === "projects"
              ? reviewUnread
              : tab === "notifications"
                ? notificationsUnread
                : 0;
          return (
            <button
              key={itemLabel}
              type="button"
              onClick={() => {
                openPanel({ tab, agentId });
                onNavigate?.();
              }}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition-colors",
                "hover:bg-sidebar-accent/50",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-foreground"
              )}
            >
              <ItemIcon className="size-4 shrink-0" />
              <span className="truncate flex-1 text-left">{itemLabel}</span>
              <NavBadge count={badge} />
            </button>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
