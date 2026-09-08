import { ChevronDownIcon, ChevronRightIcon, InfoIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FloatingWindow } from "@/components/floating/FloatingWindow";
import { useIntelligence } from "@/lib/intelligence-context";
import { useTenant } from "@/lib/tenant-context";
import { useChatUnlock } from "@/lib/chat-unlock-context";
import { useNavigate } from "react-router-dom";
import type { GraphCtaAction, GraphProjectionNode } from "@/api";
import {
  GraphLeaderboardSection,
  GraphNodeMissionsSection,
  GraphScoreboardSection,
} from "@/components/graph/GraphMissionsPanel";

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

/**
 * Information window: FloatingWindow chrome + graph-node body.
 * Later Canvas kinds (wiki, profile, code, …) share the same shell.
 */
export function InformationFloatingPanel() {
  const {
    informationPanelOpen,
    informationNode,
    closeInformationPanel,
    openPanel,
    openInformationPanel,
    setPendingChatId,
    setChatTarget,
  } = useIntelligence();
  const { authenticated } = useTenant();
  const { requestUnlock } = useChatUnlock();
  const navigate = useNavigate();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [collapsibleIds, setCollapsibleIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    const onCollapseChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        collapsedIds?: string[];
        collapsibleIds?: string[];
      }>).detail;
      if (Array.isArray(detail?.collapsedIds)) {
        setCollapsedIds(new Set(detail.collapsedIds));
      }
      if (Array.isArray(detail?.collapsibleIds)) {
        setCollapsibleIds(new Set(detail.collapsibleIds));
      }
    };
    window.addEventListener("godmode:graph-collapse-changed", onCollapseChanged);
    return () =>
      window.removeEventListener(
        "godmode:graph-collapse-changed",
        onCollapseChanged
      );
  }, []);

  const runCta = (action: GraphCtaAction, node: GraphProjectionNode) => {
    switch (action.type) {
      case "open_chat":
        if (node.kind === "chat" && node.refId) {
          setPendingChatId(node.refId);
          openPanel({ tab: "chat", maximized: false });
        } else if (node.kind === "agent" && node.refId) {
          setChatTarget({ kind: "agent", agentId: node.refId });
          openPanel({
            tab: "chat",
            agentId: node.refId,
            maximized: false,
          });
        } else {
          openPanel({ tab: "chat", maximized: false });
        }
        openInformationPanel(node);
        return;
      case "open_panel":
        openPanel({
          tab: action.tab as
            | "chat"
            | "notifications"
            | "calendar"
            | "projects"
            | "knowledge"
            | "bank"
            | "vault"
            | "support",
          maximized: false,
        });
        openInformationPanel(node);
        return;
      case "navigate":
        if (!authenticated && action.path.startsWith("/settings")) {
          navigate("/?auth=1");
          window.dispatchEvent(new CustomEvent("godmode:open-auth"));
          return;
        }
        navigate(action.path);
        openPanel({ maximized: false });
        return;
      case "open_auth":
        if (!authenticated) {
          navigate("/?auth=1");
          window.dispatchEvent(new CustomEvent("godmode:open-auth"));
        } else {
          navigate("/settings");
        }
        return;
      case "open_unlock": {
        const cap =
          action.capability === "chat_create" ? "chat_create" : "chat_window";
        requestUnlock(cap);
        return;
      }
      case "none":
      default:
        return;
    }
  };

  const node = informationNode;
  const accent = node ? KIND_COLOR[node.kind] ?? "#94a3b8" : "#a78bfa";
  const statusBits =
    node?.status
      ? Object.entries(node.status)
          .filter(
            ([k]) =>
              !["attention", "attentionCount", "openMissions"].includes(k)
          )
          .map(([k, v]) =>
            typeof v === "boolean" ? `${k}: ${v ? "yes" : "no"}` : `${k}: ${v}`
          )
      : [];

  return (
    <FloatingWindow
      open={informationPanelOpen && Boolean(node)}
      title={node ? `Information · ${node.label}` : "Information"}
      icon={<InfoIcon className="size-4" style={{ color: accent }} />}
      accent={accent}
      placement="right"
      defaultWidth={400}
      defaultHeight={520}
      onClose={closeInformationPanel}
    >
      {node ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className="capitalize"
              style={{
                backgroundColor: `${accent}22`,
                color: accent,
                borderColor: `${accent}44`,
              }}
            >
              {node.kind}
            </Badge>
            {node.status?.attention ? (
              <Badge variant="destructive">Needs attention</Badge>
            ) : null}
            {node.objectType ? (
              <span className="text-[11px] text-muted-foreground">
                {node.objectType}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-tight">
              {node.label}
            </h2>
            <p className="text-sm text-foreground/90">
              {node.description ??
                "A piece of the GodMode architecture on The Graph."}
            </p>
          </div>

          {node.securityNote ? (
            <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Security
              </p>
              <p className="mt-1 text-sm text-foreground/90">
                {node.securityNote}
              </p>
            </div>
          ) : null}

          {node.connectionLabels && node.connectionLabels.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Connected to
              </p>
              <div className="flex flex-wrap gap-1.5">
                {node.connectionLabels.map((label) => (
                  <Badge key={label} variant="outline">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {collapsibleIds.has(node.id) ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Graph tree
              </p>
              <p className="text-sm text-muted-foreground">
                {collapsedIds.has(node.id)
                  ? "Children are hidden on The Graph. Expand to show this branch."
                  : "Children are visible on The Graph. Collapse to hide this branch."}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("godmode:graph-toggle-collapse", {
                      detail: { nodeId: node.id },
                    })
                  );
                }}
              >
                {collapsedIds.has(node.id) ? (
                  <>
                    <ChevronRightIcon data-icon="inline-start" />
                    Expand on Graph
                  </>
                ) : (
                  <>
                    <ChevronDownIcon data-icon="inline-start" />
                    Collapse on Graph
                  </>
                )}
              </Button>
            </div>
          ) : null}

          {statusBits.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {statusBits.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <GraphNodeMissionsSection
            nodeId={node.id}
            onChanged={() => {
              window.dispatchEvent(
                new CustomEvent("godmode:graph-missions-changed")
              );
            }}
          />

          {node.id === "hub:you" ? (
            <>
              <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Your identity
                </p>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Account</p>
                  <p className="text-sm text-muted-foreground">
                    Sign-in, profile, and membership identity. Auth tokens never
                    appear on The Graph.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-1 self-start"
                    onClick={() =>
                      runCta({ type: "open_auth" }, node)
                    }
                  >
                    Open Account
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Cloud</p>
                  <p className="text-sm text-muted-foreground">
                    GodMode Cloud membership and plan handle (tenant id only; no
                    secrets on the map).
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-1 self-start"
                    onClick={() =>
                      runCta({ type: "navigate", path: "/settings" }, node)
                    }
                  >
                    Open Cloud settings
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">LLM keys</p>
                  <p className="text-sm text-muted-foreground">
                    Model provider credentials you own. Values are stored in User
                    Vault. Intelligence and agents use only keys you approve.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-1 self-start"
                    onClick={() =>
                      runCta({ type: "open_panel", tab: "vault" }, node)
                    }
                  >
                    Open Vault
                  </Button>
                </div>
              </div>
              <GraphScoreboardSection />
              <GraphLeaderboardSection />
            </>
          ) : null}

          <div className="mt-auto flex flex-col gap-2 border-t border-border/50 pt-3">
            {node.cta && node.cta.type !== "none" ? (
              <Button type="button" onClick={() => runCta(node.cta!, node)}>
                {node.ctaLabel ?? "Open"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={closeInformationPanel}
            >
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </FloatingWindow>
  );
}
