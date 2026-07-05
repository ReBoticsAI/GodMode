import { useCallback, useEffect, useState } from "react";
import { CheckIcon, RotateCwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useIntelligence } from "@/lib/intelligence-context";
import {
  approveReflectionProposal,
  fetchAgentReflection,
  fetchReflectionProposals,
  patchAgentReflection,
  rejectReflectionProposal,
  runAgentReflection,
  type AgentReflectionConfig,
  type ReflectionProposal,
} from "@/api";

export function ReflectionPanel() {
  const { activeAgentId } = useIntelligence();
  const [config, setConfig] = useState<AgentReflectionConfig | null>(null);
  const [proposals, setProposals] = useState<ReflectionProposal[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    fetchAgentReflection(activeAgentId)
      .then((r) => setConfig(r.reflection))
      .catch(() => setConfig(null));
    fetchReflectionProposals(activeAgentId, "pending")
      .then((r) => setProposals(r.proposals))
      .catch(() => setProposals([]));
  }, [activeAgentId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = (patch: Partial<AgentReflectionConfig>) => {
    void patchAgentReflection(activeAgentId, patch).then((r) => setConfig(r.reflection));
  };

  const reflectNow = () => {
    setRunning(true);
    void runAgentReflection(activeAgentId)
      .then(() => {
        setTimeout(load, 3000);
      })
      .finally(() => setRunning(false));
  };

  if (!config) {
    return <p className="p-3 text-sm text-muted-foreground">Loading reflection settings…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Reflection</CardTitle>
          <CardDescription className="text-[11px]">
            Periodic self-review using the main model. The agent reads recent chats and work,
            then creates or updates its own Rules, Memories, Skills, Artifacts, and Workflows.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="reflection-enabled" className="text-xs">
              Enabled
            </Label>
            <Switch
              id="reflection-enabled"
              checked={config.enabled}
              onCheckedChange={(v) => {
                setConfig({ ...config, enabled: v });
                save({ enabled: v });
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs">Apply mode</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={config.mode === "approval" ? "default" : "outline"}
                className="text-xs"
                onClick={() => save({ mode: "approval" })}
              >
                Approval
              </Button>
              <Button
                type="button"
                size="sm"
                variant={config.mode === "auto" ? "default" : "outline"}
                className="text-xs"
                onClick={() => save({ mode: "auto" })}
              >
                Auto-apply
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs font-medium">Scheduled</Label>
              <Switch
                checked={config.schedule.enabled}
                onCheckedChange={(v) =>
                  save({ schedule: { ...config.schedule, enabled: v } })
                }
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Cron</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  value={config.schedule.cron}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      schedule: { ...config.schedule, cron: e.target.value },
                    })
                  }
                  onBlur={() => save({ schedule: config.schedule })}
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Timezone</Label>
                <Input
                  className="h-8 text-xs"
                  value={config.schedule.timezone}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      schedule: { ...config.schedule, timezone: e.target.value },
                    })
                  }
                  onBlur={() => save({ schedule: config.schedule })}
                />
              </div>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs font-medium">Idle trigger</Label>
              <Switch
                checked={config.idle.enabled}
                onCheckedChange={(v) => save({ idle: { ...config.idle, enabled: v } })}
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">After minutes idle</Label>
              <Input
                type="number"
                className="h-8 w-24 text-xs"
                value={config.idle.afterMinutes}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    idle: { ...config.idle, afterMinutes: Number(e.target.value) || 30 },
                  })
                }
                onBlur={() => save({ idle: config.idle })}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={running} onClick={reflectNow}>
              {running ? "Queued…" : "Reflect now"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={load}>
              <RotateCwIcon className="size-3.5" />
            </Button>
          </div>

          {config.lastRunAt && (
            <p className="text-[10px] text-muted-foreground">
              Last run: {config.lastRunAt}
              {config.lastSummary ? ` — ${config.lastSummary.slice(0, 160)}…` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {config.mode === "approval" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Staged proposals</CardTitle>
            <CardDescription className="text-[11px]">
              Updates and deletes staged by reflection for your approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {proposals.length === 0 && (
              <p className="text-sm text-muted-foreground">No pending proposals.</p>
            )}
            {proposals.map((p) => (
              <div key={p.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {p.kind}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {p.action}
                    </Badge>
                    {p.target_id && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {p.target_id}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {p.payload_json.slice(0, 120)}
                    {p.payload_json.length > 120 ? "…" : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void approveReflectionProposal(p.id).then(load)}
                >
                  <CheckIcon className="text-emerald-500" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void rejectReflectionProposal(p.id).then(load)}
                >
                  <XIcon className="text-destructive" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
