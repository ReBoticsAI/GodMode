import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminAuthorityAuditEvents,
  fetchAdminAgentPauseStatus,
  fetchAdminCodingStatus,
  fetchAdminDeleteStatus,
  fetchAdminDeployStatus,
  fetchAdminSendStatus,
  fetchAdminSpendStatus,
  setAdminCodingKillGlobal,
  setAdminCodingKillTenant,
  setAdminDeleteKillGlobal,
  setAdminDeleteKillTenant,
  setAdminDeployKillGlobal,
  setAdminDeployKillTenant,
  setAdminSendKillGlobal,
  setAdminSendKillTenant,
  setAdminAgentPauseKillGlobal,
  setAdminAgentPauseKillTenant,
  setAdminAgentPauseAgent,
  setAdminSpendKillGlobal,
  setAdminSpendKillTenant,
  type AdminAuthorityAuditEvent,
  type AdminAgentPauseAuthorityStatus,
  type AdminCodingAuthorityStatus,
  type AdminDeleteAuthorityStatus,
  type AdminDeployAuthorityStatus,
  type AdminSendAuthorityStatus,
  type AdminSpendAuthorityStatus,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type AuditDomain =
  | "all"
  | "coding"
  | "spend"
  | "deploy"
  | "delete"
  | "send"
  | "agent";

function limitLabel(n: number): string {
  return n <= 0 ? "unlimited" : String(n);
}

function AdminAuthorityAuditSection({
  events,
  loading,
  domain,
  onDomainChange,
  onReload,
}: {
  events: AdminAuthorityAuditEvent[];
  loading: boolean;
  domain: AuditDomain;
  onDomainChange: (domain: AuditDomain) => void;
  onReload: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit feed</CardTitle>
        <CardDescription>
          Merged cross-tenant <code>tool_audit_log</code> rejects from coding,
          spend, deploy, delete, and send authority gates.
        </CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="audit-domain">Domain</Label>
              <Select
                value={domain}
                onValueChange={(v) => onDomainChange(v as AuditDomain)}
              >
                <SelectTrigger id="audit-domain" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="coding">Coding</SelectItem>
                  <SelectItem value="spend">Spend</SelectItem>
                  <SelectItem value="deploy">Deploy</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="send">Send</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReload}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        </CardAction>
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
                <TableHead>Domain</TableHead>
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
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No authority rejects logged yet.
                  </TableCell>
                </TableRow>
              ) : (
                events.map((e, i) => (
                  <TableRow key={`${e.domain}-${e.tenantId}-${e.createdAt}-${i}`}>
                    <TableCell>
                      <Badge variant="outline">{e.domain}</Badge>
                    </TableCell>
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
  );
}

function AdminAuthorityCodingSection({
  status,
  loading,
  savingKey,
  onReload,
  onToggleGlobal,
  onToggleTenant,
}: {
  status: AdminCodingAuthorityStatus | null;
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
            Quotas and kill switches for shared-host coding (Layers 1–4).
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
    </div>
  );
}

function AdminAuthoritySpendSection({
  status,
  loading,
  savingKey,
  onReload,
  onToggleGlobal,
  onToggleTenant,
}: {
  status: AdminSpendAuthorityStatus | null;
  loading: boolean;
  savingKey: string | null;
  onReload: () => void;
  onToggleGlobal: (value: boolean) => void;
  onToggleTenant: (tenantId: string, value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Spend</CardTitle>
          <CardDescription>
            Hard-stop kill switches for credit debits, Intelligence chat, and
            autonomous/queue work. Monthly caps, soft-warns, and Bank books stay
            on #91.
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
                <Badge
                  variant={
                    status.kills.envDisabled ? "destructive" : "secondary"
                  }
                >
                  Env nuclear:{" "}
                  {status.kills.envDisabled
                    ? "PLATFORM_SPEND_DISABLED"
                    : "off"}
                </Badge>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:max-w-md">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="kill-spend">Disable spend</Label>
                  <p className="text-muted-foreground text-xs">
                    Blocks new chat turns, autonomous ticks, queue jobs, and
                    negative credit adjustments platform-wide.
                  </p>
                </div>
                <Switch
                  id="kill-spend"
                  checked={status.kills.global.spendDisabled}
                  disabled={
                    savingKey === "global:spend" || status.kills.envDisabled
                  }
                  onCheckedChange={onToggleGlobal}
                />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Failed to load spend authority status.
            </p>
          )}
        </CardContent>
      </Card>

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Per-tenant spend kills</CardTitle>
            <CardDescription>
              Disable spend for a single workspace without redeploying.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Spend kill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.tenants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground">
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
                      <TableCell>
                        <Switch
                          checked={t.spendDisabled}
                          disabled={
                            savingKey === `${t.id}:spend` ||
                            status.kills.envDisabled ||
                            status.kills.global.spendDisabled
                          }
                          onCheckedChange={(v) => onToggleTenant(t.id, v)}
                          aria-label={`Disable spend for ${t.name}`}
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
    </div>
  );
}

function AdminAuthorityDeploySection({
  status,
  loading,
  savingKey,
  onReload,
  onToggleGlobal,
  onToggleTenant,
}: {
  status: AdminDeployAuthorityStatus | null;
  loading: boolean;
  savingKey: string | null;
  onReload: () => void;
  onToggleGlobal: (value: boolean) => void;
  onToggleTenant: (tenantId: string, value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Deploy</CardTitle>
          <CardDescription>
            Hard-stop kill switches for plugin esbuild, activate/install, and
            worktree promote. Layer 4 ephemeral npm builds stay under Coding
            builds kill.
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
                <Badge
                  variant={
                    status.kills.envDisabled ? "destructive" : "secondary"
                  }
                >
                  Env nuclear:{" "}
                  {status.kills.envDisabled
                    ? "PLATFORM_DEPLOY_DISABLED"
                    : "off"}
                </Badge>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:max-w-md">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="kill-deploy">Disable deploy</Label>
                  <p className="text-muted-foreground text-xs">
                    Blocks plugin build, marketplace/agent activate, and coding
                    worktree promote platform-wide.
                  </p>
                </div>
                <Switch
                  id="kill-deploy"
                  checked={status.kills.global.deployDisabled}
                  disabled={
                    savingKey === "global:deploy" || status.kills.envDisabled
                  }
                  onCheckedChange={onToggleGlobal}
                />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Failed to load deploy authority status.
            </p>
          )}
        </CardContent>
      </Card>

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Per-tenant deploy kills</CardTitle>
            <CardDescription>
              Disable deploy for a single workspace without redeploying.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Deploy kill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.tenants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground">
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
                      <TableCell>
                        <Switch
                          checked={t.deployDisabled}
                          disabled={
                            savingKey === `${t.id}:deploy` ||
                            status.kills.envDisabled ||
                            status.kills.global.deployDisabled
                          }
                          onCheckedChange={(v) => onToggleTenant(t.id, v)}
                          aria-label={`Disable deploy for ${t.name}`}
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
    </div>
  );
}

function AdminAuthorityDeleteSection({
  status,
  loading,
  savingKey,
  onReload,
  onToggleGlobal,
  onToggleTenant,
}: {
  status: AdminDeleteAuthorityStatus | null;
  loading: boolean;
  savingKey: string | null;
  onReload: () => void;
  onToggleGlobal: (value: boolean) => void;
  onToggleTenant: (tenantId: string, value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Delete</CardTitle>
          <CardDescription>
            Hard-stop kill switches for kernel record deletes, coding file
            deletes, wiki pages, and plugin uninstall. Platform-admin tenant wipe
            and reconcile uninstall stay available.
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
                <Badge
                  variant={
                    status.kills.envDisabled ? "destructive" : "secondary"
                  }
                >
                  Env nuclear:{" "}
                  {status.kills.envDisabled
                    ? "PLATFORM_DELETE_DISABLED"
                    : "off"}
                </Badge>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:max-w-md">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="kill-delete">Disable delete</Label>
                  <p className="text-muted-foreground text-xs">
                    Blocks record, file, wiki, and plugin uninstall deletes
                    platform-wide.
                  </p>
                </div>
                <Switch
                  id="kill-delete"
                  checked={status.kills.global.deleteDisabled}
                  disabled={
                    savingKey === "global:delete" || status.kills.envDisabled
                  }
                  onCheckedChange={onToggleGlobal}
                />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Failed to load delete authority status.
            </p>
          )}
        </CardContent>
      </Card>

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Per-tenant delete kills</CardTitle>
            <CardDescription>
              Disable delete for a single workspace without redeploying.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Delete kill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.tenants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground">
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
                      <TableCell>
                        <Switch
                          checked={t.deleteDisabled}
                          disabled={
                            savingKey === `${t.id}:delete` ||
                            status.kills.envDisabled ||
                            status.kills.global.deleteDisabled
                          }
                          onCheckedChange={(v) => onToggleTenant(t.id, v)}
                          aria-label={`Disable delete for ${t.name}`}
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
    </div>
  );
}

function AdminAuthoritySendSection({
  status,
  loading,
  savingKey,
  onReload,
  onToggleGlobal,
  onToggleTenant,
}: {
  status: AdminSendAuthorityStatus | null;
  loading: boolean;
  savingKey: string | null;
  onReload: () => void;
  onToggleGlobal: (value: boolean) => void;
  onToggleTenant: (tenantId: string, value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Send</CardTitle>
          <CardDescription>
            Hard-stop kill switches for automation outbound hook webhook and
            send_message actions. Auth mail, human DMs, agent replies, and
            in-app notify stay available.
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
                <Badge
                  variant={
                    status.kills.envDisabled ? "destructive" : "secondary"
                  }
                >
                  Env nuclear:{" "}
                  {status.kills.envDisabled
                    ? "PLATFORM_SEND_DISABLED"
                    : "off"}
                </Badge>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:max-w-md">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="kill-send">Disable send</Label>
                  <p className="text-muted-foreground text-xs">
                    Blocks hook webhook and send_message actions platform-wide.
                  </p>
                </div>
                <Switch
                  id="kill-send"
                  checked={status.kills.global.sendDisabled}
                  disabled={
                    savingKey === "global:send" || status.kills.envDisabled
                  }
                  onCheckedChange={onToggleGlobal}
                />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Failed to load send authority status.
            </p>
          )}
        </CardContent>
      </Card>

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Per-tenant send kills</CardTitle>
            <CardDescription>
              Disable automation send for a single workspace without
              redeploying.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Send kill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.tenants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground">
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
                      <TableCell>
                        <Switch
                          checked={t.sendDisabled}
                          disabled={
                            savingKey === `${t.id}:send` ||
                            status.kills.envDisabled ||
                            status.kills.global.sendDisabled
                          }
                          onCheckedChange={(v) => onToggleTenant(t.id, v)}
                          aria-label={`Disable send for ${t.name}`}
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
    </div>
  );
}

function AdminAuthorityAgentPauseSection({
  status,
  loading,
  savingKey,
  onReload,
  onToggleGlobal,
  onToggleTenant,
  onToggleAgent,
}: {
  status: AdminAgentPauseAuthorityStatus | null;
  loading: boolean;
  savingKey: string | null;
  onReload: () => void;
  onToggleGlobal: (value: boolean) => void;
  onToggleTenant: (tenantId: string, value: boolean) => void;
  onToggleAgent: (tenantId: string, agentId: string, value: boolean) => void;
}) {
  const agentRows =
    status?.tenants.flatMap((t) =>
      t.agents.map((a) => ({
        tenantId: t.id,
        tenantName: t.name,
        isOperator: t.isOperator,
        agentsPaused: t.agentsPaused,
        ...a,
      }))
    ) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Agent pause</CardTitle>
          <CardDescription>
            Ops instant revoke for agent LLM execution (chat, autonomous, queue,
            subagents, replies). Does not change user agent enabled toggles.
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
                <Badge
                  variant={
                    status.kills.envDisabled ? "destructive" : "secondary"
                  }
                >
                  Env nuclear:{" "}
                  {status.kills.envDisabled
                    ? "PLATFORM_AGENTS_DISABLED"
                    : "off"}
                </Badge>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:max-w-md">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pause-agents-global">Pause all agents</Label>
                  <p className="text-muted-foreground text-xs">
                    Blocks agent execution platform-wide.
                  </p>
                </div>
                <Switch
                  id="pause-agents-global"
                  checked={status.kills.global.agentsPaused}
                  disabled={
                    savingKey === "global:agents" || status.kills.envDisabled
                  }
                  onCheckedChange={onToggleGlobal}
                />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Failed to load agent pause status.
            </p>
          )}
        </CardContent>
      </Card>

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Per-tenant agent pause</CardTitle>
            <CardDescription>
              Pause all agents in one workspace without redeploying.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Tenant pause</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.tenants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground">
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
                      <TableCell>
                        <Switch
                          checked={t.agentsPaused}
                          disabled={
                            savingKey === `${t.id}:agents` ||
                            status.kills.envDisabled ||
                            status.kills.global.agentsPaused
                          }
                          onCheckedChange={(v) => onToggleTenant(t.id, v)}
                          aria-label={`Pause all agents for ${t.name}`}
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

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Per-agent pause</CardTitle>
            <CardDescription>
              Pause a single agent without changing its enabled toggle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Pause</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      No agents found.
                    </TableCell>
                  </TableRow>
                ) : (
                  agentRows.map((row) => (
                    <TableRow key={`${row.tenantId}:${row.id}`}>
                      <TableCell className="max-w-[160px] truncate text-xs">
                        {row.tenantName}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{row.name}</span>
                          <span className="text-muted-foreground font-mono text-xs">
                            {row.id}
                            {!row.enabled ? " (disabled)" : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={row.paused}
                          disabled={
                            savingKey === `${row.tenantId}:${row.id}:pause` ||
                            status.kills.envDisabled ||
                            status.kills.global.agentsPaused ||
                            row.agentsPaused
                          }
                          onCheckedChange={(v) =>
                            onToggleAgent(row.tenantId, row.id, v)
                          }
                          aria-label={`Pause agent ${row.name}`}
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
    </div>
  );
}

/** Admin → Authority: durable #96 control plane. */
export function AdminAuthorityPanel() {
  const [codingLoading, setCodingLoading] = useState(true);
  const [spendLoading, setSpendLoading] = useState(true);
  const [deployLoading, setDeployLoading] = useState(true);
  const [deleteLoading, setDeleteLoading] = useState(true);
  const [sendLoading, setSendLoading] = useState(true);
  const [agentPauseLoading, setAgentPauseLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [codingStatus, setCodingStatus] =
    useState<AdminCodingAuthorityStatus | null>(null);
  const [spendStatus, setSpendStatus] =
    useState<AdminSpendAuthorityStatus | null>(null);
  const [deployStatus, setDeployStatus] =
    useState<AdminDeployAuthorityStatus | null>(null);
  const [deleteStatus, setDeleteStatus] =
    useState<AdminDeleteAuthorityStatus | null>(null);
  const [sendStatus, setSendStatus] =
    useState<AdminSendAuthorityStatus | null>(null);
  const [agentPauseStatus, setAgentPauseStatus] =
    useState<AdminAgentPauseAuthorityStatus | null>(null);
  const [auditEvents, setAuditEvents] = useState<AdminAuthorityAuditEvent[]>(
    []
  );
  const [auditDomain, setAuditDomain] = useState<AuditDomain>("all");

  const reloadCoding = useCallback(() => {
    setCodingLoading(true);
    fetchAdminCodingStatus()
      .then(setCodingStatus)
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load coding authority"
        )
      )
      .finally(() => setCodingLoading(false));
  }, []);

  const reloadSpend = useCallback(() => {
    setSpendLoading(true);
    fetchAdminSpendStatus()
      .then(setSpendStatus)
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load spend authority"
        )
      )
      .finally(() => setSpendLoading(false));
  }, []);

  const reloadDeploy = useCallback(() => {
    setDeployLoading(true);
    fetchAdminDeployStatus()
      .then(setDeployStatus)
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load deploy authority"
        )
      )
      .finally(() => setDeployLoading(false));
  }, []);

  const reloadDelete = useCallback(() => {
    setDeleteLoading(true);
    fetchAdminDeleteStatus()
      .then(setDeleteStatus)
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load delete authority"
        )
      )
      .finally(() => setDeleteLoading(false));
  }, []);

  const reloadSend = useCallback(() => {
    setSendLoading(true);
    fetchAdminSendStatus()
      .then(setSendStatus)
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load send authority"
        )
      )
      .finally(() => setSendLoading(false));
  }, []);

  const reloadAgentPause = useCallback(() => {
    setAgentPauseLoading(true);
    fetchAdminAgentPauseStatus()
      .then(setAgentPauseStatus)
      .catch((err) =>
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to load agent pause authority"
        )
      )
      .finally(() => setAgentPauseLoading(false));
  }, []);

  const reloadAudit = useCallback(() => {
    setAuditLoading(true);
    fetchAdminAuthorityAuditEvents({
      limit: 100,
      ...(auditDomain !== "all" ? { domain: auditDomain } : {}),
    })
      .then((res) => setAuditEvents(res.events))
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load authority audit"
        )
      )
      .finally(() => setAuditLoading(false));
  }, [auditDomain]);

  useEffect(() => {
    reloadCoding();
    reloadSpend();
    reloadDeploy();
    reloadDelete();
    reloadSend();
    reloadAgentPause();
  }, [
    reloadCoding,
    reloadSpend,
    reloadDeploy,
    reloadDelete,
    reloadSend,
    reloadAgentPause,
  ]);

  useEffect(() => {
    reloadAudit();
  }, [reloadAudit]);

  const onToggleCodingGlobal = async (
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
      reloadCoding();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleCodingTenant = async (
    tenantId: string,
    field: "codingDisabled" | "buildsDisabled",
    value: boolean
  ) => {
    const key = `${tenantId}:${field === "codingDisabled" ? "coding" : "builds"}`;
    setSavingKey(key);
    try {
      await setAdminCodingKillTenant(tenantId, { [field]: value });
      toast.success("Tenant kill switch updated");
      reloadCoding();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleSpendGlobal = async (value: boolean) => {
    setSavingKey("global:spend");
    try {
      await setAdminSpendKillGlobal({ spendDisabled: value });
      toast.success(
        value ? "Spend disabled platform-wide" : "Spend re-enabled"
      );
      reloadSpend();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleSpendTenant = async (tenantId: string, value: boolean) => {
    setSavingKey(`${tenantId}:spend`);
    try {
      await setAdminSpendKillTenant(tenantId, { spendDisabled: value });
      toast.success("Tenant spend kill switch updated");
      reloadSpend();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleDeployGlobal = async (value: boolean) => {
    setSavingKey("global:deploy");
    try {
      await setAdminDeployKillGlobal({ deployDisabled: value });
      toast.success(
        value ? "Deploy disabled platform-wide" : "Deploy re-enabled"
      );
      reloadDeploy();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleDeployTenant = async (tenantId: string, value: boolean) => {
    setSavingKey(`${tenantId}:deploy`);
    try {
      await setAdminDeployKillTenant(tenantId, { deployDisabled: value });
      toast.success("Tenant deploy kill switch updated");
      reloadDeploy();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleDeleteGlobal = async (value: boolean) => {
    setSavingKey("global:delete");
    try {
      await setAdminDeleteKillGlobal({ deleteDisabled: value });
      toast.success(
        value ? "Delete disabled platform-wide" : "Delete re-enabled"
      );
      reloadDelete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleDeleteTenant = async (tenantId: string, value: boolean) => {
    setSavingKey(`${tenantId}:delete`);
    try {
      await setAdminDeleteKillTenant(tenantId, { deleteDisabled: value });
      toast.success("Tenant delete kill switch updated");
      reloadDelete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleSendGlobal = async (value: boolean) => {
    setSavingKey("global:send");
    try {
      await setAdminSendKillGlobal({ sendDisabled: value });
      toast.success(value ? "Send disabled platform-wide" : "Send re-enabled");
      reloadSend();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleSendTenant = async (tenantId: string, value: boolean) => {
    setSavingKey(`${tenantId}:send`);
    try {
      await setAdminSendKillTenant(tenantId, { sendDisabled: value });
      toast.success("Tenant send kill switch updated");
      reloadSend();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleAgentPauseGlobal = async (value: boolean) => {
    setSavingKey("global:agents");
    try {
      await setAdminAgentPauseKillGlobal({ agentsPaused: value });
      toast.success(
        value ? "All agents paused platform-wide" : "Agents unpaused"
      );
      reloadAgentPause();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleAgentPauseTenant = async (tenantId: string, value: boolean) => {
    setSavingKey(`${tenantId}:agents`);
    try {
      await setAdminAgentPauseKillTenant(tenantId, { agentsPaused: value });
      toast.success("Tenant agent pause updated");
      reloadAgentPause();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingKey(null);
    }
  };

  const onToggleAgentPauseAgent = async (
    tenantId: string,
    agentId: string,
    value: boolean
  ) => {
    setSavingKey(`${tenantId}:${agentId}:pause`);
    try {
      await setAdminAgentPauseAgent(tenantId, agentId, { paused: value });
      toast.success("Agent pause updated");
      reloadAgentPause();
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
            Coding, spend, deploy, delete, send hard-stops, unified audit, and
            agent pause are live in this tab.
          </CardDescription>
        </CardHeader>
      </Card>

      <AdminAuthorityAuditSection
        events={auditEvents}
        loading={auditLoading}
        domain={auditDomain}
        onDomainChange={setAuditDomain}
        onReload={reloadAudit}
      />

      <AdminAuthorityCodingSection
        status={codingStatus}
        loading={codingLoading}
        savingKey={savingKey}
        onReload={reloadCoding}
        onToggleGlobal={onToggleCodingGlobal}
        onToggleTenant={onToggleCodingTenant}
      />

      <AdminAuthoritySpendSection
        status={spendStatus}
        loading={spendLoading}
        savingKey={savingKey}
        onReload={reloadSpend}
        onToggleGlobal={onToggleSpendGlobal}
        onToggleTenant={onToggleSpendTenant}
      />

      <AdminAuthorityDeploySection
        status={deployStatus}
        loading={deployLoading}
        savingKey={savingKey}
        onReload={reloadDeploy}
        onToggleGlobal={onToggleDeployGlobal}
        onToggleTenant={onToggleDeployTenant}
      />

      <AdminAuthorityDeleteSection
        status={deleteStatus}
        loading={deleteLoading}
        savingKey={savingKey}
        onReload={reloadDelete}
        onToggleGlobal={onToggleDeleteGlobal}
        onToggleTenant={onToggleDeleteTenant}
      />

      <AdminAuthoritySendSection
        status={sendStatus}
        loading={sendLoading}
        savingKey={savingKey}
        onReload={reloadSend}
        onToggleGlobal={onToggleSendGlobal}
        onToggleTenant={onToggleSendTenant}
      />

      <AdminAuthorityAgentPauseSection
        status={agentPauseStatus}
        loading={agentPauseLoading}
        savingKey={savingKey}
        onReload={reloadAgentPause}
        onToggleGlobal={onToggleAgentPauseGlobal}
        onToggleTenant={onToggleAgentPauseTenant}
        onToggleAgent={onToggleAgentPauseAgent}
      />
    </div>
  );
}
