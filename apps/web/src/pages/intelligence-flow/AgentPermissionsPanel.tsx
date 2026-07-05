import { useEffect, useMemo, useState } from "react";
import {
  fetchAgentAssignments,
  fetchAuthSession,
  updateAiAgent,
  type AiAgent,
  type AiAgentAssignment,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function AgentPermissionsPanel({
  agent,
  onSaved,
}: {
  agent: AiAgent;
  onSaved?: (agent: AiAgent) => void;
}) {
  const [assignments, setAssignments] = useState<AiAgentAssignment[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [codeAccess, setCodeAccess] = useState(Boolean(agent.config?.codeAccess));
  const [codeAutonomy, setCodeAutonomy] = useState(Boolean(agent.config?.codeAutonomy));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCodeAccess(Boolean(agent.config?.codeAccess) || agent.id === "intelligence");
    setCodeAutonomy(Boolean(agent.config?.codeAutonomy));
  }, [agent.id, agent.updatedAt, agent.config]);

  useEffect(() => {
    fetchAgentAssignments()
      .then((r) =>
        setAssignments(r.assignments.filter((a) => a.agent_id === agent.id))
      )
      .catch(() => setAssignments([]));
    fetchAuthSession()
      .then((r) => setIsAdmin(Boolean(r.user?.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, [agent.id]);

  const tools = useMemo(() => {
    if (agent.toolAllow === null || agent.toolAllow === undefined) {
      return ["Workspace default allowlist"];
    }
    if (agent.toolAllow.length === 0) {
      return ["No tools (explicit empty allow-list)"];
    }
    if (agent.toolAllow.includes("*")) {
      return ["All tools (wildcard)"];
    }
    return agent.toolAllow;
  }, [agent.toolAllow]);

  const saveCodingPerms = async () => {
    setSaving(true);
    try {
      const next = await updateAiAgent(agent.id, {
        config: {
          ...(agent.config ?? {}),
          codeAccess: agent.id === "intelligence" ? true : codeAccess,
          codeAutonomy,
        },
      });
      onSaved?.(next);
      toast.success("Coding permissions updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Agent RBAC is separate from user project roles (
        <code className="rounded bg-muted px-1">tenant_memberships</code>). This
        agent&apos;s scope is defined by assignments, allowed tools, and
        auto-approve rules.
      </p>

      {isAdmin && agent.id !== "intelligence" ? (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <Label className="text-xs font-medium">Coding / terminal access</Label>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span>codeAccess — expose read_file, edit_file, run_terminal, etc.</span>
            <Switch checked={codeAccess} onCheckedChange={setCodeAccess} />
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span>codeAutonomy — auto-approve coding/terminal tools (no prompt)</span>
            <Switch
              checked={codeAutonomy}
              onCheckedChange={setCodeAutonomy}
              disabled={!codeAccess}
            />
          </div>
          <Button size="sm" className="w-fit" disabled={saving} onClick={() => void saveCodingPerms()}>
            {saving ? "Saving…" : "Save coding permissions"}
          </Button>
        </div>
      ) : agent.id === "intelligence" ? (
        <p className="text-xs text-muted-foreground">
          Intelligence always has codeAccess. Toggle codeAutonomy via admin agent config if needed.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium">Scope assignments</Label>
        {assignments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No explicit structure assignments. May inherit from org hierarchy only.
          </p>
        ) : (
          assignments.map((a) => (
            <div
              key={`${a.scope_type}:${a.scope_id}`}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
            >
              <span className="truncate">
                {a.scope_type}/{a.scope_id}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {a.role}
              </Badge>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium">Allowed tools</Label>
        <div className="flex flex-wrap gap-1">
          {tools.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium">Auto-approve</Label>
        {agent.autoApprove.length === 0 ? (
          <p className="text-xs text-muted-foreground">None — all actions require confirmation.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {agent.autoApprove.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
