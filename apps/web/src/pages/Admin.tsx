import { useCallback, useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { CreditCardIcon } from "lucide-react";
import {
  fetchAdminSupportTickets,
  fetchBridgeHealth,
  fetchSupportTicket,
  postSupportMessage,
  updateAdminSupportTicket,
  fetchAdminBillingConfig,
  updateAdminBillingConfig,
  testAdminBillingConnection,
  fetchSupportGroup,
  addSupportGroupMember,
  removeSupportGroupMember,
  fetchUsers,
  fetchAiAgents,
  type PlatformBillingConfig,
  type SupportGroupMember,
  type SupportMessage,
  type SupportTicket,
  type SupportTicketStatus,
  type AdminUserRow,
  type AiAgent,
} from "@/api";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { USERS_PATH } from "@/lib/navigation";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StructureAdminPanel } from "@/pages/StructureAdminPanel";
import { AdminUsersPanel } from "@/pages/admin/AdminUsersPanel";
import { AdminSaasCustomersPanel } from "@/pages/admin/AdminSaasCustomersPanel";
import { AdminMarketplaceFeesPanel } from "@/pages/admin/AdminMarketplaceFeesPanel";
import { UpdatesCard } from "@/components/admin/UpdatesCard";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Admin() {
  const { user } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isHub, setIsHub] = useState(false);
  const [isSaas, setIsSaas] = useState(false);
  const tabParam = searchParams.get("tab");
  const tab =
    tabParam === "platform" || tabParam === "structure"
      ? tabParam === "structure"
        ? "template"
        : isHub
          ? "billing"
          : "template"
      : (tabParam ?? (isHub ? "billing" : "template"));

  useEffect(() => {
    void fetchBridgeHealth()
      .then((h) => {
        setIsHub(Boolean(h.hub));
        setIsSaas(Boolean(h.saas));
      })
      .catch(() => {
        setIsHub(false);
        setIsSaas(false);
      });
  }, []);

  if (!user?.isAdmin) {
    return <Navigate to={USERS_PATH} replace />;
  }

  return (
    <Page>
      <PageHeader
        title="Admin"
        description={
          isSaas
            ? "Billing, SaaS customers, updates, workspace template, users, and support."
            : isHub
              ? "Billing, updates, workspace template, users, and support."
              : "Updates, workspace template, users, and support."
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })}
        className="w-full"
      >
        <TabsList variant="line" className="w-full flex-wrap justify-start">
          {isHub ? <TabsTrigger value="billing">Billing</TabsTrigger> : null}
          {isSaas ? <TabsTrigger value="saas">SaaS</TabsTrigger> : null}
          <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="template">Workspace template</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
        </TabsList>

        {isHub ? (
          <TabsContent value="billing" className="mt-4">
            <AdminBillingTab />
          </TabsContent>
        ) : null}
        {isSaas ? (
          <TabsContent value="saas" className="mt-4">
            <AdminSaasCustomersPanel />
          </TabsContent>
        ) : null}
        <TabsContent value="marketplace" className="mt-4">
          <AdminMarketplaceFeesPanel />
        </TabsContent>
        <TabsContent value="updates" className="mt-4">
          <UpdatesCard />
        </TabsContent>
        <TabsContent value="template" className="mt-4">
          <StructureAdminPanel />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <AdminUsersPanel />
        </TabsContent>
        <TabsContent value="support" className="mt-4 space-y-4">
          <AdminSupportGroupCard />
          <AdminSupportTab />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function AdminBillingTab() {
  const [cfg, setCfg] = useState<PlatformBillingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [creditsPerUsd, setCreditsPerUsd] = useState("100");

  const reload = useCallback(() => {
    setLoading(true);
    fetchAdminBillingConfig()
      .then((c) => {
        setCfg(c);
        setPublishableKey(c.publishableKey ?? "");
        setCreditsPerUsd(String(c.creditsPerUsd));
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to load billing")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateAdminBillingConfig({
        secretKey: secretKey || undefined,
        publishableKey,
        creditsPerUsd: Number(creditsPerUsd),
      });
      setCfg(updated);
      setSecretKey("");
      toast.success("Billing settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await testAdminBillingConnection();
      if (result.ok) {
        toast.success(result.detail ?? "Stripe connected");
      } else {
        toast.error(result.detail ?? "Connection failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCardIcon className="size-5" />
          Marketplace billing
        </CardTitle>
        <CardDescription>
          Connect Stripe for marketplace credit purchases. Secret keys are encrypted
          in the platform database.
        </CardDescription>
        <CardAction>
          {cfg && (
            <Badge variant={cfg.configured ? "default" : "secondary"}>
              {cfg.configured ? "Configured" : "Not configured"}
            </Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex max-w-lg flex-col gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="stripe-secret">Stripe secret key</Label>
              <Input
                id="stripe-secret"
                type="password"
                autoComplete="off"
                placeholder={
                  cfg?.hasSecretKey ? "•••••••• (leave blank to keep)" : "sk_live_…"
                }
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="stripe-publishable">Publishable key</Label>
              <Input
                id="stripe-publishable"
                placeholder="pk_live_…"
                value={publishableKey}
                onChange={(e) => setPublishableKey(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="credits-per-usd">Credits per $1 USD</Label>
              <Input
                id="credits-per-usd"
                type="number"
                min={1}
                value={creditsPerUsd}
                onChange={(e) => setCreditsPerUsd(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Spinner className="size-4" /> : "Save"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void test()}
                disabled={testing || !cfg?.configured}
              >
                {testing ? <Spinner className="size-4" /> : "Test connection"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const SUPPORT_STATUSES: SupportTicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

const SUPPORT_STATUS_TONE: Record<SupportTicketStatus, string> = {
  open: "bg-blue-500/15 text-blue-400",
  in_progress: "bg-amber-500/15 text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-400",
  closed: "bg-muted text-muted-foreground",
};

function AdminSupportGroupCard() {
  const { activeTenantId } = useTenant();
  const [members, setMembers] = useState<SupportGroupMember[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [pickUser, setPickUser] = useState("");
  const [pickAgent, setPickAgent] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [group, userRes, agentRes] = await Promise.all([
        fetchSupportGroup(),
        fetchUsers(),
        fetchAiAgents().catch(() => ({ agents: [] as AiAgent[] })),
      ]);
      setMembers(group.members);
      setUsers(userRes.users);
      setAgents(agentRes.agents);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load Support group");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addUser = async () => {
    if (!pickUser) return;
    try {
      await addSupportGroupMember({ memberKind: "user", memberId: pickUser });
      setPickUser("");
      toast.success("User added to Support group");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add user");
    }
  };

  const addAgent = async () => {
    if (!pickAgent) return;
    if (!activeTenantId) {
      toast.error("Select a workspace before adding an agent");
      return;
    }
    try {
      await addSupportGroupMember({
        memberKind: "agent",
        memberId: pickAgent,
        tenantId: activeTenantId,
      });
      setPickAgent("");
      toast.success("Agent added to Support group");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add agent");
    }
  };

  const removeMember = async (m: SupportGroupMember) => {
    try {
      await removeSupportGroupMember({
        memberKind: m.member_kind,
        memberId: m.member_id,
        tenantId: m.tenant_id,
      });
      toast.success("Removed from Support group");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const userLabel = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? `${u.displayName} (${u.email})` : id.slice(0, 8);
  };
  const agentLabel = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Support group</CardTitle>
        <CardDescription>
          Users and agents here can answer hub and shared-resource tickets (Staff inbox on
          Support). Platform admins always can.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {members.length === 0 ? (
                <li className="text-sm text-muted-foreground">No members yet.</li>
              ) : (
                members.map((m) => (
                  <li
                    key={`${m.member_kind}:${m.member_id}:${m.tenant_id ?? ""}`}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <Badge variant="secondary" className="text-[10px]">
                      {m.member_kind}
                    </Badge>
                    <span className="truncate">
                      {m.member_kind === "user"
                        ? userLabel(m.member_id)
                        : agentLabel(m.member_id)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => void removeMember(m)}
                    >
                      Remove
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <Label>Add user</Label>
                <Select value={pickUser} onValueChange={(v) => setPickUser(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.displayName} ({u.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => void addUser()} disabled={!pickUser}>
                Add user
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <Label>Add agent (this workspace)</Label>
                <Select value={pickAgent} onValueChange={(v) => setPickAgent(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => void addAgent()} disabled={!pickAgent}>
                Add agent
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AdminSupportTab() {
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<"all" | SupportTicketStatus>(
    "all"
  );
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [active, setActive] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminSupportTickets(
        statusFilter === "all" ? undefined : statusFilter
      );
      setTickets(res.tickets);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTicket = useCallback(async (t: SupportTicket) => {
    setActive(t);
    try {
      const res = await fetchSupportTicket(t.id);
      setActive(res.ticket);
      setMessages(res.messages);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load ticket");
    }
  }, []);

  // Deep link from a notification: ?tab=support&ticket=<id>
  useEffect(() => {
    const ticketId = searchParams.get("ticket");
    if (ticketId && tickets.length > 0 && active?.id !== ticketId) {
      const t = tickets.find((x) => x.id === ticketId);
      if (t) void openTicket(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, tickets]);

  const changeStatus = useCallback(
    async (status: SupportTicketStatus) => {
      if (!active) return;
      try {
        const res = await updateAdminSupportTicket(active.id, { status });
        setActive(res.ticket);
        void load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update");
      }
    },
    [active, load]
  );

  const sendReply = useCallback(async () => {
    if (!active || !reply.trim()) return;
    try {
      await postSupportMessage(active.id, reply.trim());
      setReply("");
      const res = await fetchSupportTicket(active.id);
      setMessages(res.messages);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reply");
    }
  }, [active, reply]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Support tickets</CardTitle>
        <CardDescription>Triage and respond to user requests.</CardDescription>
        <CardAction>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {SUPPORT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-1">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tickets.</p>
            ) : (
              tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void openTicket(t)}
                  className={cn(
                    "flex flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent/50",
                    active?.id === t.id ? "border-primary/40 bg-primary/5" : ""
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{t.subject}</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "ml-auto text-[10px]",
                        SUPPORT_STATUS_TONE[t.status]
                      )}
                    >
                      {t.status}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {t.category ? `${t.category} · ` : ""}
                    {t.updated_at}
                  </span>
                </button>
              ))
            )}
          </div>

          <div>
            {active ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{active.subject}</p>
                  <Select
                    value={active.status}
                    onValueChange={(v) =>
                      void changeStatus(v as SupportTicketStatus)
                    }
                  >
                    <SelectTrigger className="ml-auto w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm",
                        m.author_kind === "admin"
                          ? "border-violet-500/20 bg-violet-500/5"
                          : "bg-muted/40"
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {m.author_kind}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {m.created_at}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <Textarea
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply as admin…"
                  />
                  <Button
                    className="self-end"
                    onClick={() => void sendReply()}
                    disabled={!reply.trim()}
                  >
                    Send reply
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a ticket to view the conversation.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
