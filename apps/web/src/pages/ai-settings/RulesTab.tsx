import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useIntelligence } from "@/lib/intelligence-context";
import {
  approveAiRule,
  fetchAiRules,
  rejectAiRule,
  updateAiRuleState,
  type AiRule,
} from "@/api";
import {
  isInherited,
  KnowledgeSearchFilterBar,
  KnowledgeStatusFilter,
  KnowledgeSummaryLine,
  matchesKnowledgeStatusFilter,
  OwnershipBadge,
  VersionMeta,
} from "./knowledge-badges";

function RuleApplicabilityBadges({ rule }: { rule: AiRule }) {
  if (rule.status === "pending") {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
        Pending approval
      </Badge>
    );
  }
  if (!rule.enabled) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        Disabled
      </Badge>
    );
  }
  return (
    <>
      {rule.alwaysApply && (
        <Badge variant="secondary" className="text-[10px]">
          Always
        </Badge>
      )}
      {!rule.alwaysApply && rule.globs.length === 0 && rule.departments.length === 0 && (
        <Badge variant="outline" className="text-[10px]">
          Contextual
        </Badge>
      )}
      {rule.globs.map((g) => (
        <Badge key={g} variant="outline" className="text-[10px]">
          {g}
        </Badge>
      ))}
      {rule.departments.map((d) => (
        <Badge key={d} variant="outline" className="text-[10px]">
          Dept: {d}
        </Badge>
      ))}
    </>
  );
}

function RuleMetaBadges({ rule, activeAgentId }: { rule: AiRule; activeAgentId: string }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <RuleApplicabilityBadges rule={rule} />
      <OwnershipBadge ownerAgentId={rule.agentId} activeAgentId={activeAgentId} />
    </div>
  );
}

export function RulesTab() {
  const { activeAgentId } = useIntelligence();
  const [rules, setRules] = useState<AiRule[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<KnowledgeStatusFilter>("all");

  const load = useCallback(() => {
    fetchAiRules(activeAgentId)
      .then((r) => setRules(r.rules))
      .catch(() => setRules([]));
  }, [activeAgentId]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const pending = rules.filter((r) => r.status === "pending").length;
    const active = rules.filter((r) => r.status !== "pending" && r.enabled).length;
    const disabled = rules.filter((r) => r.status !== "pending" && !r.enabled).length;
    const inherited = rules.filter((r) => isInherited(r.agentId, activeAgentId)).length;
    return { active, disabled, pending, inherited };
  }, [rules, activeAgentId]);

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (!matchesKnowledgeStatusFilter(filter, r)) return false;
      if (!q) return true;
      return (
        r.description.toLowerCase().includes(q) ||
        r.body.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.globs.some((g) => g.toLowerCase().includes(q)) ||
        r.departments.some((d) => d.toLowerCase().includes(q))
      );
    });
  }, [rules, search, filter]);

  const pending = filteredRules.filter((r) => r.status === "pending");
  const active = filteredRules.filter((r) => r.status !== "pending");

  const statusFilters: Array<{ id: KnowledgeStatusFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "disabled", label: "Disabled" },
    { id: "pending", label: "Pending" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Rules overview</CardTitle>
          <CardDescription className="text-[11px]">
            DB-backed guardrails injected into prompts when applicable (always-on, path globs, or
            department scope). Root Intelligence rules are inherited and can be toggled per agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KnowledgeSummaryLine {...summary} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Browse rules</CardTitle>
        </CardHeader>
        <CardContent>
          <KnowledgeSearchFilterBar
            search={search}
            onSearchChange={setSearch}
            filter={filter}
            onFilterChange={setFilter}
            filters={statusFilters}
            placeholder="Search description, body, globs…"
          />
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending rules ({pending.length})</CardTitle>
            <CardDescription>
              Proposed by Reflection. Approve to apply in prompts, or reject to delete the draft.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pending.map((r) => (
              <div
                key={r.id}
                className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.description}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{r.id}</p>
                  <RuleMetaBadges rule={r} activeAgentId={activeAgentId} />
                  <VersionMeta version={r.version} updatedAt={r.updatedAt} />
                  <pre className="mt-1 max-h-20 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10px]">
                    {r.body.slice(0, 200)}
                    {r.body.length > 200 ? "…" : ""}
                  </pre>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void approveAiRule(r.id, activeAgentId).then(load)}
                >
                  <CheckIcon className="text-emerald-500" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void rejectAiRule(r.id, activeAgentId).then(load)}
                >
                  <XIcon className="text-destructive" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active rules</CardTitle>
          <CardDescription>
            Enabled rules participate in prompt assembly when their scope matches the current context.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {rules.length === 0 ? "No rules yet." : "No rules match the current filter."}
            </p>
          )}
          {active.map((r) => (
            <div key={r.id} className="rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.description}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {r.id} · priority {r.priority}
                  </p>
                </div>
                <Switch
                  checked={r.enabled}
                  onCheckedChange={(v) => {
                    void updateAiRuleState(r.id, {
                      enabled: v,
                      agentId: activeAgentId,
                    }).then(load);
                  }}
                />
              </div>
              <RuleMetaBadges rule={r} activeAgentId={activeAgentId} />
              <VersionMeta version={r.version} updatedAt={r.updatedAt} />
              <pre className="mt-2 max-h-24 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10px]">
                {r.body.slice(0, 300)}
                {r.body.length > 300 ? "…" : ""}
              </pre>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
