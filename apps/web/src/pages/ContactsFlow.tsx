import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import { MessageCircleIcon } from "lucide-react";
import { FlowCanvas, FlowInspector, FlowWorkspace } from "@/components/flow";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserProfilePanel } from "@/components/UserProfilePanel";
import { fetchDmContacts, type DmContact } from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { useIntelligence } from "@/lib/intelligence-context";
import { cn } from "@/lib/utils";

type Relationship = DmContact["relationship"];

/** Edge/label styling per relationship kind. */
const RELATIONSHIP_META: Record<
  Relationship,
  { label: string; color: string; tone: string }
> = {
  share: {
    label: "Shared with you",
    color: "#10b981",
    tone: "bg-emerald-500/15 text-emerald-400",
  },
  tenant: {
    label: "Same project",
    color: "#38bdf8",
    tone: "bg-sky-500/15 text-sky-400",
  },
  lookup: {
    label: "Directory",
    color: "#a1a1aa",
    tone: "bg-muted text-muted-foreground",
  },
};

const YOU_ID = "__you__";

function Avatar({
  name,
  avatarUrl,
  online,
  size = 28,
}: {
  name: string;
  avatarUrl?: string | null;
  online?: boolean;
  size?: number;
}) {
  const initial = name.trim()?.[0]?.toUpperCase() ?? "?";
  return (
    <span className="relative inline-flex shrink-0">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          className="flex items-center justify-center rounded-full bg-muted text-xs font-semibold"
          style={{ width: size, height: size }}
        >
          {initial}
        </span>
      )}
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-emerald-500" />
      )}
    </span>
  );
}

/** Lays contacts out on concentric rings around the central "you" node. */
function radialPosition(index: number, total: number) {
  const perRing = 9;
  const ring = Math.floor(index / perRing);
  const inRing = index % perRing;
  const countInThisRing = Math.min(perRing, total - ring * perRing);
  const radius = 280 + ring * 200;
  const angle = (inRing / Math.max(1, countInThisRing)) * Math.PI * 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function ContactsFlowChart() {
  const { user } = useTenant();
  const { openPanel } = useIntelligence();
  const [searchParams, setSearchParams] = useSearchParams();
  const [contacts, setContacts] = useState<DmContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const consumedNodeParam = useRef(false);

  const youName =
    user?.displayName?.trim() || user?.email?.split("@")[0] || "You";

  // Deep-link: `?node=self` (from the sidebar profile button) opens the profile.
  useEffect(() => {
    if (consumedNodeParam.current) return;
    if (searchParams.get("node") === "self") {
      consumedNodeParam.current = true;
      setSelectedId(YOU_ID);
      const next = new URLSearchParams(searchParams);
      next.delete("node");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDmContacts()
      .then((r) => {
        if (!cancelled) setContacts(r.contacts);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const youNode: Node = {
      id: YOU_ID,
      position: { x: 0, y: 0 },
      data: {
        label: (
          <div className="flex items-center gap-2">
            <Avatar
              name={youName}
              avatarUrl={user?.avatarUrl}
              online
              size={34}
            />
            <div className="flex flex-col text-left leading-tight">
              <span className="text-sm font-semibold">{youName}</span>
              <span className="text-[10px] text-muted-foreground">You</span>
            </div>
          </div>
        ),
      },
      style: {
        background: "hsl(var(--primary) / 0.12)",
        border: "1px solid hsl(var(--primary) / 0.5)",
        borderRadius: 14,
        padding: "8px 12px",
        width: "auto",
      },
    };

    const contactNodes: Node[] = contacts.map((c, i) => {
      const meta = RELATIONSHIP_META[c.relationship];
      return {
        id: c.id,
        position: radialPosition(i, contacts.length),
        data: {
          label: (
            <div className="flex items-center gap-2">
              <Avatar
                name={c.displayName || c.email}
                avatarUrl={c.avatarUrl}
                online={c.online}
              />
              <span className="max-w-[120px] truncate text-xs font-medium">
                {c.displayName || c.email}
              </span>
            </div>
          ),
        },
        style: {
          background: "hsl(var(--card))",
          border: `1px solid ${meta.color}55`,
          borderRadius: 12,
          padding: "6px 10px",
          width: "auto",
        },
      };
    });

    const contactEdges: Edge[] = contacts.map((c) => {
      const meta = RELATIONSHIP_META[c.relationship];
      return {
        id: `${YOU_ID}-${c.id}`,
        source: YOU_ID,
        target: c.id,
        animated: c.relationship === "share",
        style: { stroke: meta.color, strokeWidth: 1.5 },
      };
    });

    setNodes([youNode, ...contactNodes]);
    setEdges(contactEdges);
  }, [contacts, youName, user?.avatarUrl, setNodes, setEdges]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId]
  );

  const counts = useMemo(() => {
    const c: Record<Relationship, number> = { share: 0, tenant: 0, lookup: 0 };
    for (const ct of contacts) c[ct.relationship] += 1;
    return c;
  }, [contacts]);

  const inspector =
    selectedId === YOU_ID ? (
      <FlowInspector
        title={youName}
        subtitle="You — profile, account & projects"
        width="default"
        className="w-[460px]"
      >
        <UserProfilePanel />
      </FlowInspector>
    ) : selectedContact ? (
      <FlowInspector
        title={selectedContact.displayName || selectedContact.email}
        subtitle={RELATIONSHIP_META[selectedContact.relationship].label}
        width="narrow"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar
              name={selectedContact.displayName || selectedContact.email}
              avatarUrl={selectedContact.avatarUrl}
              online={selectedContact.online}
              size={48}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {selectedContact.displayName || selectedContact.email}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {selectedContact.email}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px]",
                RELATIONSHIP_META[selectedContact.relationship].tone
              )}
            >
              {RELATIONSHIP_META[selectedContact.relationship].label}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {selectedContact.online ? "Online" : "Offline"}
            </Badge>
          </div>

          <Button
            size="sm"
            onClick={() =>
              openPanel({ tab: "chat", contactUserId: selectedContact.id })
            }
          >
            <MessageCircleIcon data-icon="inline-start" />
            Message
          </Button>
        </div>
      </FlowInspector>
    ) : (
      <FlowInspector
        title="Your network"
        emptyDescription="Select a contact to see how you're connected and start a conversation."
        width="narrow"
      >
        <div className="flex flex-col gap-3 text-xs">
          <p className="text-muted-foreground">
            {loading
              ? "Loading contacts…"
              : `${contacts.length} connection${contacts.length === 1 ? "" : "s"}`}
          </p>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(RELATIONSHIP_META) as Relationship[]).map((rel) => (
              <div key={rel} className="flex items-center gap-2">
                <span
                  className="h-0.5 w-5 rounded-full"
                  style={{ background: RELATIONSHIP_META[rel].color }}
                />
                <span className="flex-1 text-muted-foreground">
                  {RELATIONSHIP_META[rel].label}
                </span>
                <span className="font-medium">{counts[rel]}</span>
              </div>
            ))}
          </div>
        </div>
      </FlowInspector>
    );

  return (
    <FlowWorkspace
      canvas={
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          nodesConnectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
        />
      }
      inspector={inspector}
    />
  );
}

export default function ContactsFlow() {
  return (
    <Page className="flex h-[calc(100dvh-7rem)] max-w-none flex-col gap-4">
      <PageHeader
        title="Users"
        description="Your network — you at the center, connected to everyone you collaborate with. Each line shows how you're related; click a contact to message them."
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <ContactsFlowChart />
      </div>
    </Page>
  );
}
