import { Label } from "@/components/ui/label";
import { fetchAiAgents } from "@/api";
import { useEffect, useState } from "react";

export function DelegationTab() {
  const [agents, setAgents] = useState<Array<{ id: string; name: string; backend: string }>>([]);

  useEffect(() => {
    fetchAiAgents()
      .then((r) =>
        setAgents(
          r.agents.map((a) => ({ id: a.id, name: a.name, backend: a.backend }))
        )
      )
      .catch(() => setAgents([]));
  }, []);

  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      <p>
        Intelligence can invoke other subagents on the fly using the{" "}
        <code className="rounded bg-muted px-1">delegate_to_subagent</code> tool (requires
        confirmation). Delegation is bounded (default 120s wall clock; optional{" "}
        <code className="rounded bg-muted px-1">timeoutMs</code> up to 300s) and returns{" "}
        <code className="rounded bg-muted px-1">status: ok | timeout | error</code> so the
        parent can recover instead of hanging. Assign subagents to project cards or
        workflow agent nodes via <code className="rounded bg-muted px-1">agentId</code>.
      </p>
      <Label className="text-[11px] text-foreground">Available subagents</Label>
      <ul className="max-h-48 space-y-1 overflow-auto rounded-md border bg-muted/20 p-2">
        {agents.map((a) => (
          <li key={a.id} className="font-mono text-[10px]">
            {a.name}{" "}
            <span className="text-muted-foreground">
              ({a.id}) · {a.backend}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
