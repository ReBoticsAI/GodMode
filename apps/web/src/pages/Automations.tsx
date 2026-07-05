import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { WorkflowFlow } from "@/components/intelligence/workflow/WorkflowFlow";
import { ProjectsBoard } from "@/components/intelligence/projects/ProjectsBoard";
import { SchedulesTab } from "@/pages/ai-settings/SchedulesTab";
import {
  approveHookRun,
  createHook,
  deleteHook,
  fetchAiSchedules,
  fetchAiWorkflows,
  fetchEvents,
  fetchHookRuns,
  fetchHooks,
  rejectHookRun,
  updateHook,
  type AiWorkflow,
  type AppEvent,
  type CreateHookBody,
  type Hook,
  type HookActionKind,
  type HookRun,
  type HookTriggerKind,
} from "@/api";

const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Daily 9am", value: "0 9 * * *" },
  { label: "Weekdays 8am", value: "0 8 * * 1-5" },
];

const ACTION_KINDS: HookActionKind[] = [
  "notify",
  "run_agent",
  "run_workflow",
  "send_message",
  "webhook",
];

const ACTION_LABELS: Record<HookActionKind, string> = {
  notify: "Notify",
  run_agent: "Run agent",
  run_workflow: "Run workflow",
  send_message: "Send message",
  webhook: "Webhook",
};

interface ConditionRow {
  field: string;
  op: string;
  value: string;
}

interface DraftState {
  name: string;
  ownerKind: "user" | "agent";
  ownerId: string;
  triggerKind: HookTriggerKind;
  eventType: string;
  scheduleCron: string;
  actionKind: HookActionKind;
  actionConfig: string;
  workflowId: string;
  workflowInputs: string;
  conditions: ConditionRow[];
  rateLimitPerHour: string;
  requireApproval: boolean;
}

const DEFAULT_ACTION_CONFIG: Record<HookActionKind, string> = {
  notify: JSON.stringify({ title: "{{eventType}} fired", body: "" }, null, 2),
  run_agent: JSON.stringify({ agentId: "", prompt: "" }, null, 2),
  run_workflow: JSON.stringify({ workflowId: "", inputs: "" }, null, 2),
  send_message: JSON.stringify({ conversationId: "", text: "" }, null, 2),
  webhook: JSON.stringify({ url: "", method: "POST" }, null, 2),
};

function emptyDraft(scheduleOnly: boolean, agentId?: string): DraftState {
  return {
    name: "",
    ownerKind: agentId ? "agent" : "user",
    ownerId: agentId ?? "",
    triggerKind: scheduleOnly ? "schedule" : "event",
    eventType: "dm.message.created",
    scheduleCron: "0 9 * * *",
    actionKind: scheduleOnly ? "run_workflow" : "notify",
    actionConfig: scheduleOnly
      ? DEFAULT_ACTION_CONFIG.run_workflow
      : DEFAULT_ACTION_CONFIG.notify,
    workflowId: "",
    workflowInputs: "",
    conditions: [],
    rateLimitPerHour: "",
    requireApproval: false,
  };
}

/**
 * Hooks management surface. Reused by both the Hooks tab (full event + schedule
 * automations) and the Schedules tab (`scheduleOnly` → schedule-triggered hooks
 * only, the single source of truth for new cron automations).
 */
function HooksManager({
  scheduleOnly = false,
  agentId,
}: {
  scheduleOnly?: boolean;
  /** When set, list/create hooks scoped to this agent only. */
  agentId?: string;
}) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<AiWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(scheduleOnly, agentId));
  const [runsFor, setRunsFor] = useState<Hook | null>(null);
  const [runs, setRuns] = useState<HookRun[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, e] = await Promise.all([fetchHooks(), fetchEvents(50)]);
      setHooks(h.hooks);
      setAgentIds(h.agentIds);
      setEventTypes(e.eventTypes);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Workflow picker source: the selected agent's workflows (or the user's
  // default 'intelligence' agent). Loaded whenever the run_workflow action is
  // selected so the dropdown stays in sync with the chosen owner.
  const workflowAgentId =
    draft.ownerKind === "agent" && draft.ownerId ? draft.ownerId : "intelligence";
  useEffect(() => {
    if (!dialogOpen || draft.actionKind !== "run_workflow") return;
    fetchAiWorkflows(workflowAgentId)
      .then((r) => setWorkflows(r.workflows))
      .catch(() => setWorkflows([]));
  }, [dialogOpen, draft.actionKind, workflowAgentId]);

  const openRuns = useCallback(async (hook: Hook) => {
    setRunsFor(hook);
    try {
      const res = await fetchHookRuns(hook.id);
      setRuns(res.runs);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);

  const openCreate = useCallback(() => {
    setDraft(emptyDraft(scheduleOnly, agentId));
    setDialogOpen(true);
  }, [scheduleOnly, agentId]);

  const submit = useCallback(async () => {
    try {
      const condition =
        draft.conditions.length > 0
          ? {
              all: draft.conditions
                .filter((c) => c.field.trim())
                .map((c) => ({ field: c.field, op: c.op, value: c.value })),
            }
          : null;
      // For run_workflow, build the action config from the dropdown + inputs so
      // the user never hand-edits JSON for the common case.
      const actionConfigJson =
        draft.actionKind === "run_workflow"
          ? JSON.stringify({
              workflowId: draft.workflowId,
              inputs: draft.workflowInputs || undefined,
            })
          : draft.actionConfig || null;
      const body: CreateHookBody = {
        name: draft.name || "Untitled automation",
        ownerKind: draft.ownerKind,
        ownerId: draft.ownerKind === "agent" ? draft.ownerId : undefined,
        triggerKind: draft.triggerKind,
        eventType: draft.triggerKind === "event" ? draft.eventType : null,
        scheduleCron: draft.triggerKind === "schedule" ? draft.scheduleCron : null,
        conditionJson: condition ? JSON.stringify(condition) : null,
        actionKind: draft.actionKind,
        actionConfigJson,
        rateLimitPerHour: draft.rateLimitPerHour
          ? Number(draft.rateLimitPerHour)
          : null,
        requireApproval: draft.requireApproval,
      };
      if (draft.actionKind === "run_workflow" && !draft.workflowId) {
        toast.error("Pick a workflow to run");
        return;
      }
      await createHook(body);
      toast.success("Automation created");
      setDialogOpen(false);
      setDraft(emptyDraft(scheduleOnly, agentId));
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [draft, load, scheduleOnly, agentId]);

  const toggleEnabled = useCallback(
    async (hook: Hook) => {
      try {
        await updateHook(hook.id, { enabled: hook.enabled !== 1 });
        void load();
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [load]
  );

  const remove = useCallback(
    async (hook: Hook) => {
      try {
        await deleteHook(hook.id);
        void load();
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [load]
  );

  const decide = useCallback(
    async (runId: string, approve: boolean) => {
      try {
        if (approve) await approveHookRun(runId);
        else await rejectHookRun(runId);
        if (runsFor) await openRuns(runsFor);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [runsFor, openRuns]
  );

  const ownerOptions = useMemo(
    () => [{ kind: "user" as const, id: "me", label: "Me (user)" }],
    []
  );

  const visibleHooks = useMemo(() => {
    let list = scheduleOnly
      ? hooks.filter((h) => h.trigger_kind === "schedule")
      : hooks;
    if (agentId) {
      list = list.filter((h) => h.owner_kind === "agent" && h.owner_id === agentId);
    }
    return list;
  }, [hooks, scheduleOnly, agentId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {scheduleOnly
            ? "Cron-triggered automations. Run a workflow, agent, or notification on a schedule."
            : "Event- and schedule-driven hooks that notify you, run agents, run workflows, send messages, or call webhooks."}
        </p>
        <Button size="sm" onClick={openCreate}>
          {scheduleOnly ? "New schedule" : "New automation"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : visibleHooks.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {scheduleOnly ? "No schedules yet" : "No automations yet"}
            </CardTitle>
            <CardDescription>
              {scheduleOnly
                ? "Create a cron schedule to run a workflow or agent automatically."
                : "Create a hook to react to platform events or run on a schedule."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {visibleHooks.map((h) => (
            <li key={h.id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{h.name}</p>
                    <Badge variant="secondary" className="text-[10px]">
                      {h.trigger_kind === "event"
                        ? h.event_type
                        : `cron: ${h.schedule_cron}`}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {ACTION_LABELS[h.action_kind] ?? h.action_kind}
                    </Badge>
                    {h.owner_kind === "agent" && (
                      <Badge className="text-[10px]">agent: {h.owner_id}</Badge>
                    )}
                    {h.require_approval === 1 && (
                      <Badge variant="outline" className="text-[10px]">
                        approval
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {h.rate_limit_per_hour
                      ? `Rate limit: ${h.rate_limit_per_hour}/hr · `
                      : ""}
                    {h.last_fired_at ? `Last fired ${h.last_fired_at}` : "Never fired"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={h.enabled === 1}
                    onCheckedChange={() => void toggleEnabled(h)}
                  />
                  <Button size="sm" variant="ghost" onClick={() => void openRuns(h)}>
                    Runs
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(h)}>
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {scheduleOnly ? "New schedule" : "New automation"}
            </DialogTitle>
            <DialogDescription>
              Choose a trigger, an optional condition, and an action.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={
                  scheduleOnly ? "Run morning briefing workflow" : "Notify me on new DMs"
                }
              />
            </div>

            {!agentId && (
              <div className="space-y-1.5">
                <Label>Owner</Label>
                <Select
                  value={draft.ownerKind === "user" ? "me" : `agent:${draft.ownerId}`}
                  onValueChange={(v) => {
                    if (!v) return;
                    if (v === "me") setDraft({ ...draft, ownerKind: "user", ownerId: "" });
                    else
                      setDraft({
                        ...draft,
                        ownerKind: "agent",
                        ownerId: v.slice("agent:".length),
                      });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ownerOptions.map((o) => (
                      <SelectItem key={o.id} value="me">
                        {o.label}
                      </SelectItem>
                    ))}
                    {agentIds.map((id) => (
                      <SelectItem key={id} value={`agent:${id}`}>
                        Agent: {id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!scheduleOnly && (
              <div className="space-y-1.5">
                <Label>Trigger</Label>
                <Select
                  value={draft.triggerKind}
                  onValueChange={(v) =>
                    setDraft({ ...draft, triggerKind: v as HookTriggerKind })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="event">On event</SelectItem>
                    <SelectItem value="schedule">On schedule (cron)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {draft.triggerKind === "event" ? (
              <div className="space-y-1.5">
                <Label>Event type</Label>
                <Select
                  value={draft.eventType}
                  onValueChange={(v) => v && setDraft({ ...draft, eventType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {eventTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Wildcards like <code>dm.*</code> are supported — type directly:
                </p>
                <Input
                  value={draft.eventType}
                  onChange={(e) => setDraft({ ...draft, eventType: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Schedule (cron)</Label>
                <Select
                  value={draft.scheduleCron}
                  onValueChange={(v) => v && setDraft({ ...draft, scheduleCron: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRON_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label} ({p.value})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={draft.scheduleCron}
                  onChange={(e) =>
                    setDraft({ ...draft, scheduleCron: e.target.value })
                  }
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Conditions (all must match)</Label>
              {draft.conditions.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    className="flex-1"
                    placeholder="field (e.g. text)"
                    value={c.field}
                    onChange={(e) => {
                      const next = [...draft.conditions];
                      next[i] = { ...c, field: e.target.value };
                      setDraft({ ...draft, conditions: next });
                    }}
                  />
                  <Select
                    value={c.op}
                    onValueChange={(v) => {
                      if (!v) return;
                      const next = [...draft.conditions];
                      next[i] = { ...c, op: v };
                      setDraft({ ...draft, conditions: next });
                    }}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["eq", "neq", "contains", "startsWith", "gt", "lt", "exists"].map(
                        (op) => (
                          <SelectItem key={op} value={op}>
                            {op}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <Input
                    className="flex-1"
                    placeholder="value"
                    value={c.value}
                    onChange={(e) => {
                      const next = [...draft.conditions];
                      next[i] = { ...c, value: e.target.value };
                      setDraft({ ...draft, conditions: next });
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        conditions: draft.conditions.filter((_, j) => j !== i),
                      })
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraft({
                    ...draft,
                    conditions: [
                      ...draft.conditions,
                      { field: "", op: "eq", value: "" },
                    ],
                  })
                }
              >
                Add condition
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Action</Label>
              <Select
                value={draft.actionKind}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    actionKind: v as HookActionKind,
                    actionConfig: DEFAULT_ACTION_CONFIG[v as HookActionKind],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_KINDS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {ACTION_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {draft.actionKind === "run_workflow" ? (
                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">Workflow</Label>
                  <Select
                    value={draft.workflowId}
                    onValueChange={(v) => v && setDraft({ ...draft, workflowId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a workflow" />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows.length === 0 ? (
                        <SelectItem value="__none__" disabled>
                          No workflows for {workflowAgentId}
                        </SelectItem>
                      ) : (
                        workflows.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Label className="text-xs text-muted-foreground">
                    Inputs (optional) — seeds the workflow trigger node
                  </Label>
                  <Textarea
                    rows={3}
                    className="font-mono text-xs"
                    value={draft.workflowInputs}
                    onChange={(e) =>
                      setDraft({ ...draft, workflowInputs: e.target.value })
                    }
                    placeholder="Use {{field}} placeholders to inject event payload values."
                  />
                </div>
              ) : (
                <>
                  <Textarea
                    rows={5}
                    className="font-mono text-xs"
                    value={draft.actionConfig}
                    onChange={(e) =>
                      setDraft({ ...draft, actionConfig: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Use <code>{"{{field}}"}</code> placeholders to inject event payload
                    values (e.g. <code>{"{{senderDisplayName}}"}</code>).
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1.5">
                <Label>Rate limit (per hour)</Label>
                <Input
                  type="number"
                  value={draft.rateLimitPerHour}
                  onChange={(e) =>
                    setDraft({ ...draft, rateLimitPerHour: e.target.value })
                  }
                  placeholder="unlimited"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch
                  checked={draft.requireApproval}
                  onCheckedChange={(v) =>
                    setDraft({ ...draft, requireApproval: v })
                  }
                />
                <Label>Require approval</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Runs dialog */}
      <Dialog open={!!runsFor} onOpenChange={(o) => !o && setRunsFor(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Run log — {runsFor?.name}</DialogTitle>
            <DialogDescription>Most recent executions first.</DialogDescription>
          </DialogHeader>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {runs.map((r) => (
                <li key={r.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant={
                        r.status === "error"
                          ? "destructive"
                          : r.status === "success"
                            ? "default"
                            : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {r.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {r.created_at}
                    </span>
                  </div>
                  {r.detail && (
                    <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>
                  )}
                  {r.status === "pending_approval" && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => void decide(r.id, true)}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void decide(r.id, false)}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type AutomationsTabId = "tasks" | "workflows" | "hooks" | "schedules" | "events";

function buildAutomationsTabs(showTasks: boolean, showEvents: boolean): AutomationsTabId[] {
  const tabs: AutomationsTabId[] = [];
  if (showTasks) tabs.push("tasks");
  tabs.push("workflows", "hooks", "schedules");
  if (showEvents) tabs.push("events");
  return tabs;
}

function eventMatchesAgent(ev: AppEvent, agentId: string): boolean {
  if (ev.actor_kind === "agent" && ev.actor_id === agentId) return true;
  if (ev.payload_json && ev.payload_json.includes(agentId)) return true;
  return false;
}

function summarizeEventPayload(payloadJson: string | null): string {
  if (!payloadJson) return "";
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    const keys = Object.keys(parsed).slice(0, 4);
    if (keys.length === 0) return "";
    return keys.map((k) => `${k}: ${String(parsed[k]).slice(0, 80)}`).join(" · ");
  } catch {
    return payloadJson.slice(0, 120);
  }
}

/** Read-only recent platform events, best-effort filtered to an agent cockpit. */
function EventsList({ agentId }: { agentId: string }) {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchEvents(50)
      .then((r) => {
        const filtered = r.events.filter((ev) => eventMatchesAgent(ev, agentId));
        setEvents(filtered);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [agentId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <p className="text-sm text-muted-foreground">
        Recent platform events involving this agent (read-only). Hook triggers use
        these event types.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No matching events</CardTitle>
            <CardDescription>
              Events appear when this agent acts or is referenced in an event payload.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {events.map((ev) => (
            <li key={ev.id} className="rounded-lg border bg-card px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {ev.type}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {ev.actor_kind}
                  {ev.actor_id ? `: ${ev.actor_id}` : ""}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {ev.created_at}
                </span>
              </div>
              {ev.payload_json && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {summarizeEventPayload(ev.payload_json)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface AutomationsPanelProps {
  /** When set, scopes hooks/schedules/events to this agent and enables cockpit mode. */
  agentId?: string;
  /** Show the Kanban Tasks sub-tab (default tab when true). */
  showTasks?: boolean;
  /** Show read-only Events sub-tab. */
  showEvents?: boolean;
}

/**
 * Embeddable Automations surface. Self-contained — manages its own sub-tab state.
 * Without props: global Workflows/Hooks/Schedules (Agents workspace).
 * With agentId + showTasks/showEvents: per-agent cockpit in the chat panel.
 */
export function AutomationsPanel({
  agentId,
  showTasks = false,
  showEvents = false,
}: AutomationsPanelProps = {}) {
  const tabIds = useMemo(
    () => buildAutomationsTabs(showTasks, showEvents),
    [showTasks, showEvents]
  );
  const defaultTab = showTasks ? "tasks" : "workflows";
  const [tab, setTab] = useState<AutomationsTabId>(defaultTab);
  const [agentWorkflowIds, setAgentWorkflowIds] = useState<string[] | undefined>();
  const [legacyScheduleCount, setLegacyScheduleCount] = useState<number | null>(null);

  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab, agentId]);

  useEffect(() => {
    if (!agentId) {
      setAgentWorkflowIds(undefined);
      setLegacyScheduleCount(null);
      return;
    }
    let cancelled = false;
    void Promise.all([fetchAiWorkflows(agentId), fetchAiSchedules()])
      .then(([wfRes, schedRes]) => {
        if (cancelled) return;
        const wfIds = wfRes.workflows.map((w) => w.id);
        setAgentWorkflowIds(wfIds);
        const idSet = new Set(wfIds);
        setLegacyScheduleCount(
          schedRes.schedules.filter((s) => idSet.has(s.workflow_id)).length
        );
      })
      .catch(() => {
        if (!cancelled) {
          setAgentWorkflowIds([]);
          setLegacyScheduleCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const showLegacySchedulesCard =
    !agentId || legacyScheduleCount === null || legacyScheduleCount > 0;

  const tabLabel: Record<AutomationsTabId, string> = {
    tasks: "Tasks",
    workflows: "Workflows",
    hooks: "Hooks",
    schedules: "Schedules",
    events: "Events",
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden px-2 py-2">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as AutomationsTabId)}
        className="flex h-full min-h-0 w-full flex-col"
      >
        <TabsList variant="line" className="w-full shrink-0 flex-wrap justify-start">
          {tabIds.map((id) => (
            <TabsTrigger key={id} value={id}>
              {tabLabel[id]}
            </TabsTrigger>
          ))}
        </TabsList>

        {showTasks && agentId && (
          <TabsContent
            value="tasks"
            className="mt-2 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            <ProjectsBoard scope={{ kind: "agent", agentId }} />
          </TabsContent>
        )}

        <TabsContent
          value="workflows"
          className="mt-2 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <WorkflowFlow />
        </TabsContent>

        <TabsContent
          value="hooks"
          className="mt-4 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
        >
          <HooksManager agentId={agentId} />
        </TabsContent>

        <TabsContent
          value="schedules"
          className="mt-4 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
        >
          <div className="flex flex-col gap-4">
            <HooksManager scheduleOnly agentId={agentId} />
            {showLegacySchedulesCard && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Workflow cron schedules (legacy)
                  </CardTitle>
                  <CardDescription>
                    Read-only view of the older <code>ai_schedules</code> system that
                    enqueues a workflow on a cron. Prefer schedule-triggered hooks
                    above.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SchedulesTab workflowIds={agentWorkflowIds} />
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {showEvents && agentId && (
          <TabsContent
            value="events"
            className="mt-4 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
          >
            <EventsList agentId={agentId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
