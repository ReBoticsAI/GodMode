import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useIntelligence } from "@/lib/intelligence-context";
import {
  approveAiSkill,
  fetchAiSkills,
  rejectAiSkill,
  updateAiSkillState,
  type AiSkill,
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

function SkillReadinessBadge({ skill }: { skill: AiSkill }) {
  if (skill.status === "pending") {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
        Pending approval
      </Badge>
    );
  }
  if (!skill.enabled) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        Disabled
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-600">
      Indexed
    </Badge>
  );
}

function SkillMetaBadges({ skill, activeAgentId }: { skill: AiSkill; activeAgentId: string }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <SkillReadinessBadge skill={skill} />
      <OwnershipBadge ownerAgentId={skill.agentId} activeAgentId={activeAgentId} />
      {skill.tools.map((t) => (
        <Badge key={t} variant="outline" className="text-[10px]">
          {t}
        </Badge>
      ))}
      {skill.departments.map((d) => (
        <Badge key={d} variant="outline" className="text-[10px]">
          Dept: {d}
        </Badge>
      ))}
    </div>
  );
}

export function SkillsTab() {
  const { activeAgentId } = useIntelligence();
  const [skills, setSkills] = useState<AiSkill[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<KnowledgeStatusFilter>("all");

  const load = useCallback(() => {
    fetchAiSkills(true, activeAgentId)
      .then((r) => setSkills(r.skills))
      .catch(() => setSkills([]));
  }, [activeAgentId]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const pending = skills.filter((s) => s.status === "pending").length;
    const active = skills.filter((s) => s.status !== "pending" && s.enabled).length;
    const disabled = skills.filter((s) => s.status !== "pending" && !s.enabled).length;
    const inherited = skills.filter((s) => isInherited(s.agentId, activeAgentId)).length;
    return { active, disabled, pending, inherited };
  }, [skills, activeAgentId]);

  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (!matchesKnowledgeStatusFilter(filter, s)) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.tools.some((t) => t.toLowerCase().includes(q)) ||
        s.departments.some((d) => d.toLowerCase().includes(q)) ||
        (s.body ?? "").toLowerCase().includes(q)
      );
    });
  }, [skills, search, filter]);

  const pending = filteredSkills.filter((s) => s.status === "pending");
  const active = filteredSkills.filter((s) => s.status !== "pending");

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
          <CardTitle className="text-sm">Skills overview</CardTitle>
          <CardDescription className="text-[11px]">
            DB-backed instruction bundles for this agent. Enabled skills appear in the skills index;
            full bodies load on demand via /skill or use_skill. Root skills are inherited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KnowledgeSummaryLine {...summary} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Browse skills</CardTitle>
        </CardHeader>
        <CardContent>
          <KnowledgeSearchFilterBar
            search={search}
            onSearchChange={setSearch}
            filter={filter}
            onFilterChange={setFilter}
            filters={statusFilters}
            placeholder="Search name, description, tools…"
          />
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending skills ({pending.length})</CardTitle>
            <CardDescription>
              Proposed by Reflection. Approve to add to the skills index, or reject to discard.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pending.map((s) => (
              <div
                key={s.id}
                className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{s.id}</p>
                  <SkillMetaBadges skill={s} activeAgentId={activeAgentId} />
                  <VersionMeta version={s.version} updatedAt={s.updatedAt} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void approveAiSkill(s.id, activeAgentId).then(load)}
                >
                  <CheckIcon className="text-emerald-500" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void rejectAiSkill(s.id, activeAgentId).then(load)}
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
          <CardTitle>Active skills</CardTitle>
          <CardDescription>
            Toggle skills in or out of the index injected into prompts for this agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {skills.length === 0 ? "No skills yet." : "No skills match the current filter."}
            </p>
          )}
          {active.map((s) => (
            <div key={s.id} className="rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                </div>
                <Switch
                  checked={s.enabled}
                  onCheckedChange={(v) => {
                    void updateAiSkillState(s.id, v, activeAgentId).then(load);
                  }}
                />
              </div>
              <SkillMetaBadges skill={s} activeAgentId={activeAgentId} />
              <VersionMeta version={s.version} updatedAt={s.updatedAt} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
