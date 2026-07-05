import { useCallback, useEffect, useState } from "react";
import { CheckIcon, RotateCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import {
  approveReflectionProposal,
  fetchReflectionProposals,
  rejectReflectionProposal,
  runAgentReflection,
  type ReflectionProposal,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Persona self-improvement panel: shows pending profile/memory proposals that an
 * agent has learned from recent chats, with approve/reject and a manual refresh.
 * Moved out of the user profile page so it lives next to the agent in
 * Agents > Pipeline (the "Agent Profile" node inspector).
 */
export function PersonaProposalsPanel({
  agentId,
  onApplied,
}: {
  agentId: string | null;
  onApplied?: () => void;
}) {
  const [proposals, setProposals] = useState<ReflectionProposal[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    if (!agentId) {
      setProposals([]);
      return;
    }
    fetchReflectionProposals(agentId, "pending")
      .then((r) =>
        setProposals(
          r.proposals.filter(
            (p) => p.kind === "user_profile" || p.kind === "user_memory"
          )
        )
      )
      .catch(() => setProposals([]));
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = async () => {
    if (!agentId) return;
    setRunning(true);
    try {
      await runAgentReflection(agentId);
      toast.success("Persona refresh started — check back in a moment.");
      window.setTimeout(load, 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run refresh");
    } finally {
      setRunning(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveReflectionProposal(id);
      toast.success("Proposal applied");
      load();
      onApplied?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectReflectionProposal(id);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">Persona learning</p>
          <p className="text-[11px] text-muted-foreground">
            Suggested profile &amp; memory updates from recent chats. Approve
            before they apply.
          </p>
        </div>
        <Button
          variant="outline"
          size="xs"
          disabled={!agentId || running}
          onClick={() => void handleRefresh()}
        >
          <RotateCwIcon
            data-icon="inline-start"
            className={running ? "animate-spin" : undefined}
          />
          {running ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {proposals.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No pending proposals. Run a refresh after chatting with this agent.
        </p>
      ) : (
        proposals.map((p) => (
          <div key={p.id} className="flex items-start gap-2 rounded-md border px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-[10px]">
                  {p.kind}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {p.action}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {p.payload_json.slice(0, 160)}
                {p.payload_json.length > 160 ? "…" : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void handleApprove(p.id)}
            >
              <CheckIcon className="text-emerald-500" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void handleReject(p.id)}
            >
              <XIcon className="text-destructive" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
