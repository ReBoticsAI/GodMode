import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminCodingEvents,
  fetchAdminCodingStatus,
  setAdminCodingKillGlobal,
  setAdminCodingKillTenant,
  type AdminCodingAuthorityEvent,
  type AdminCodingAuthorityStatus,
} from "@/api";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

function limitLabel(n: number): string {
  return n <= 0 ? "unlimited" : String(n);
}

function AdminAuthorityCodingSection({
  status,
  events,
  loading,
  savingKey,
  onReload,
  onToggleGlobal,
  onToggleTenant,
}: {
  status: AdminCodingAuthorityStatus | null;
  events: AdminCodingAuthorityEvent[];
  loading: boolean;
  savingKey: string | null;
  onReload: () => void;
  onToggleGlobal: (
    field: "codingDisabled" | "buildsDisabled",
    value: boolean
  ) => void;
  onToggleTenant: (
    tenantId: string,
    field: "codingDisabled" | "buildsDisabled",
    value: boolean
  ) => void;
}) {
  const limits = status?.quota.limits;
  const live = status?.quota.live;
  const supervisor = status?.supervisor;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Coding</CardTitle>
          <CardDescription>
            Quotas, kill switches, and reject feed for shared-host coding
            (Layers 1–4). Later Authority sections (spend, send, deploy,
            delete) land beside this block.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReload}
              disabled={loading}
            >
              Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading && !status ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : status ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant={status.platform.isSaas ? "default" : "secondary"}>
                  {status.platform.isSaas ? "SaaS" : "Hub / local"}
                </Badge>
                <Badge
                  variant={
                    status.platform.saasAllowCodeAccess ? "default" : "destructive"
                  }
                >
                  Env code access:{" "}
                  {status.platform.saasAllowCodeAccess ? "on" : "off"}
                </Badge>
                <Badge variant="outline">
                  Build mode: {limits?.buildMode ?? "off"}
                </Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="kill-coding">Disable coding</Label>
                    <p className="text-muted-foreground text-xs">
                      Blocks terminal, PTY, Coding UI, and coding tools
                      platform-wide.
                    </p>
                  </div>
                  <Switch
                    id="kill-coding"
                    checked={status.kills.global.codingDisabled}
                    disabled={savingKey === "global:coding"}
                    onCheckedChange={(v) => onToggleGlobal("codingDisabled", v)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="kill-builds">Disable builds</Label>
                    <p className="text-muted-foreground text-xs">
                      Blocks Layer 4 ephemeral builds platform-wide.
                    </p>
                  </div>
                  <Switch
                    id="kill-builds"
                    checked={status.kills.global.buildsDisabled}
                    disabled={savingKey === "global:builds"}
                    onCheckedChange={(v) => onToggleGlobal("buildsDisabled", v)}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Failed to load coding authority status.
            </p>
          )}
        </CardContent>
      </Card>

      {status && limits && live ? (
        <Card>
          <CardHeader>
            <CardTitle>Limits and live load</CardTitle>
            <CardDescription>
              Configured concurrency (env) and in-process Bridge terminal
              slots. Build concurrency comes from the host supervisor when
              Layer 4 is enabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-muted-foreground">Terminal global</p>
              <p className="font-medium">
                {live.terminalGlobalActive} / {limitLabel(limits.terminalGlobal)}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-muted-foreground">Terminal per tenant</p>
              <p className="font-medium">{limitLabel(limits.terminalTenant)}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-muted-foreground">PTY max per tenant</p>
              <p className="font-medium">{limitLabel(limits.ptyMaxPerTenant)}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-muted-foreground">Build global (config)</p>
              <p className="font-medium">{limitLabel(limits.buildGlobal)}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-muted-foreground">Build per tenant (config)</p>
              <p className="font-medium">{limitLabel(limits.buildTenant)}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-muted-foreground">Supervisor</p>
              {supervisor == null ? (
                <p className="font-medium">Not configured</p>
              ) : supervisor.reachable ? (
                <p className="font-medium">
                  {supervisor.concurrency?.globalActive ?? "?"} /{" "}
                  {supervisor.concurrency?.globalLimit ?? "?"}
                  {supervisor.ok ? "" : " (degraded)"}
                </p>
              ) : (
                <p className="text-destructive font-medium text-xs">
                  Unreachable{supervisor.error ? `: ${supervisor.error}` : ""}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Per-tenant kills</CardTitle>
            <CardDescription>
              Disable coding or builds for a single workspace without
              redeploying.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Terminal</TableHead>
                  <TableHead>PTY</TableHead>
                  <TableHead>Coding kill</TableHead>
                  <TableHead>Builds kill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.tenants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No tenants found.
                    </TableCell>
                  </TableRow>
                ) : (
                  status.tenants.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{t.name}</span>
                          <span className="text-muted-foreground font-mono text-xs">
                            {t.id}
                            {t.isOperator ? " (operator)" : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{t.terminalActive}</TableCell>
                      <TableCell>{t.openPtySessions}</TableCell>
                      <TableCell>
                        <Switch
                          checked={t.codingDisabled}
                          disabled={savingKey === `${t.id}:coding`}
                          onCheckedChange={(v) =>
                            onToggleTenant(t.id, "codingDisabled", v)
                          }
                          aria-label={`Disable coding for ${t.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={t.buildsDisabled}
                          disabled={savingKey === `${t.id}:builds`}
                          onCheckedChange={(v) =>
                            onToggleTenant(t.id, "buildsDisabled", v)
                          }
                          aria-label={`Disable builds for ${t.name}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent rejects</CardTitle>
          <CardDescription>
            Cross-tenant <code>tool_audit_log</code> rows with{" "}
            <code>quota:*</code> or <code>kill:*</code> results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && events.length === 0 ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No quota or kill rejects logged yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  events.map((e, i) => (
                    <TableRow key={`${e.tenantId}-${e.createdAt}-${i}`}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {e.createdAt}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs">
                        {e.tenantName ?? e.tenantId}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.agentId}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.action}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{e.result}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Admin → Authority: durable #96 control plane. Coding is Slice 2; more sections follow. */
export function AdminAuthorityPanel() {
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminCodingAuthorityStatus | null>(null);
  const [events, setEvents] = useState<AdminCodingAuthorityEvent[]>([]);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([fetchAdminCodingStatus(), fetchAdminCodingEvents({ limit: 100 })])
      .then(([s, e]) => {
        setStatus(s);
        setEvents(e.events);
      })
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load authority status"
        )
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const onToggleGlobal = async (
    field: "codingDisabled" | "buildsDisabled",
    value: boolean
  ) => {
    const key = field === "codingDisabled" ? "global:coding" : "global:builds";
    setSavingKey(key);
    try {
      await setAdminCodingKillGlobal({ [field]: value });
      toast.success(
        field === "codingDisabled"
          ? value
            ? "Coding disabled platform-wide"
            : "Coding re-enabled"
          : value
            ? "Builds disabled platform-wide"
            : "Builds re-enabled"
      );
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleTenant = async (
    tenantId: string,
    field: "codingDisabled" | "buildsDisabled",
    value: boolean
  ) => {
    const key = `${tenantId}:${field === "codingDisabled" ? "coding" : "builds"}`;
    setSavingKey(key);
    try {
      await setAdminCodingKillTenant(tenantId, { [field]: value });
      toast.success("Tenant kill switch updated");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Authority</CardTitle>
          <CardDescription>
            Platform-admin control and visibility for bounded delegation (#96).
            Each epic slice adds a section here. Coding quotas and kill switches
            are first; spend / send / deploy / delete follow later.
          </CardDescription>
        </CardHeader>
      </Card>

      <AdminAuthorityCodingSection
        status={status}
        events={events}
        loading={loading}
        savingKey={savingKey}
        onReload={reload}
        onToggleGlobal={onToggleGlobal}
        onToggleTenant={onToggleTenant}
      />
    </div>
  );
}
