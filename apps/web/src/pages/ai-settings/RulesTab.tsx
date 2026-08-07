import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon, DownloadIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useIntelligence } from "@/lib/intelligence-context";
import {
  approveAiRule,
  createAiRule,
  deleteAiRule,
  fetchAiRules,
  importWorkspaceKnowledge,
  importCursorUserKnowledge,
  rejectAiRule,
  updateAiRuleContent,
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
  SourceBadge,
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
      <SourceBadge sourcePluginId={rule.sourcePluginId} userEdited={rule.userEdited} />
      <RuleApplicabilityBadges rule={rule} />
      <OwnershipBadge ownerAgentId={rule.agentId} activeAgentId={activeAgentId} />
    </div>
  );
}

type RuleFormState = {
  description: string;
  body: string;
  alwaysApply: boolean;
};

const emptyRuleForm = (): RuleFormState => ({
  description: "",
  body: "",
  alwaysApply: true,
});

export function RulesTab() {
  const { activeAgentId } = useIntelligence();
  const [rules, setRules] = useState<AiRule[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<KnowledgeStatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editRule, setEditRule] = useState<AiRule | null>(null);
  const [form, setForm] = useState<RuleFormState>(emptyRuleForm);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingUser, setImportingUser] = useState(false);

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

  const openCreate = () => {
    setForm(emptyRuleForm());
    setCreateOpen(true);
  };

  const openEdit = (rule: AiRule) => {
    setForm({
      description: rule.description,
      body: rule.body,
      alwaysApply: rule.alwaysApply,
    });
    setEditRule(rule);
  };

  const submitCreate = async () => {
    const description = form.description.trim();
    const body = form.body.trim();
    if (!description || !body) {
      toast.error("Description and body are required");
      return;
    }
    setSaving(true);
    try {
      await createAiRule({
        description,
        body,
        alwaysApply: form.alwaysApply,
        agentId: activeAgentId,
      });
      toast.success("Rule created");
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!editRule) return;
    const description = form.description.trim();
    const body = form.body.trim();
    if (!description || !body) {
      toast.error("Description and body are required");
      return;
    }
    setSaving(true);
    try {
      await updateAiRuleContent(editRule.id, {
        description,
        body,
        alwaysApply: form.alwaysApply,
        agentId: activeAgentId,
      });
      toast.success("Rule updated");
      setEditRule(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update rule");
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (rule: AiRule) => {
    if (!window.confirm(`Delete rule "${rule.description}"?`)) return;
    try {
      await deleteAiRule(rule.id, activeAgentId);
      toast.success("Rule deleted");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete rule");
    }
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const result = await importWorkspaceKnowledge(activeAgentId);
      if (result.message) {
        toast.message(result.message);
      } else if (result.synced) {
        toast.success(`Imported ${result.rules} rules and ${result.skills} skills from coding root`);
      } else {
        toast.message("Coding root is unchanged since last import");
      }
      load();
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === "TimeoutError") ||
        (err instanceof Error && /aborted|timeout/i.test(err.message));
      toast.error(
        aborted
          ? "Import timed out. Bridge may be busy; retry in a moment."
          : err instanceof Error
            ? err.message
            : "Import failed"
      );
    } finally {
      setImporting(false);
    }
  };

  const runUserImport = async () => {
    setImportingUser(true);
    try {
      const result = await importCursorUserKnowledge(activeAgentId);
      if (result.message) {
        toast.message(result.message);
      } else if (result.synced) {
        toast.success(
          `Imported ${result.rules} rules and ${result.skills} skills from Cursor user`
        );
      } else {
        toast.message("Cursor user Rules/Skills unchanged since last import");
      }
      load();
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === "TimeoutError") ||
        (err instanceof Error && /aborted|timeout/i.test(err.message));
      toast.error(
        aborted
          ? "Import timed out. Bridge may be busy; retry in a moment."
          : err instanceof Error
            ? err.message
            : "Import failed"
      );
    } finally {
      setImportingUser(false);
    }
  };

  const ruleFormFields = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Description</Label>
        <Input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Short label for this rule"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Body</Label>
        <Textarea
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          placeholder="Rule instructions (markdown)"
          rows={8}
          className="font-mono text-xs"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-xs">Always apply</Label>
          <p className="text-[10px] text-muted-foreground">
            Inject into every prompt for this agent (when enabled).
          </p>
        </div>
        <Switch
          checked={form.alwaysApply}
          onCheckedChange={(v) => setForm((f) => ({ ...f, alwaysApply: v }))}
        />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Rules overview</CardTitle>
              <CardDescription className="text-[11px]">
                DB-backed guardrails injected into prompts when applicable. Prefer editing rules
                here in Knowledge; AGENTS.md and <code className="text-[10px]">.cursor/</code>{" "}
                files are bootstrap imports from the coding root or your Cursor user profile.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => void runImport()} disabled={importing || importingUser}>
                {importing ? <Spinner className="size-3.5" /> : <DownloadIcon className="size-3.5" />}
                Import from coding root
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void runUserImport()}
                disabled={importing || importingUser}
              >
                {importingUser ? <Spinner className="size-3.5" /> : <DownloadIcon className="size-3.5" />}
                Import Cursor user
              </Button>
              <Button type="button" size="sm" onClick={openCreate}>
                <PlusIcon className="size-3.5" />
                New rule
              </Button>
            </div>
          </div>
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
          {active.map((r) => {
            const owned = !isInherited(r.agentId, activeAgentId);
            return (
              <div key={r.id} className="rounded-lg border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.description}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {r.id} · priority {r.priority}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {owned && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title="Edit rule"
                          onClick={() => openEdit(r)}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title="Delete rule"
                          onClick={() => void removeRule(r)}
                        >
                          <Trash2Icon className="size-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
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
                </div>
                <RuleMetaBadges rule={r} activeAgentId={activeAgentId} />
                <VersionMeta version={r.version} updatedAt={r.updatedAt} />
                <pre className="mt-2 max-h-24 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10px]">
                  {r.body.slice(0, 300)}
                  {r.body.length > 300 ? "…" : ""}
                </pre>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New rule</DialogTitle>
            <DialogDescription>
              Create a native rule for this agent. It is stored in the knowledge database, not in
              the coding root.
            </DialogDescription>
          </DialogHeader>
          {ruleFormFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submitCreate()} disabled={saving}>
              {saving ? <Spinner className="size-4" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editRule != null} onOpenChange={(open) => !open && setEditRule(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit rule</DialogTitle>
            <DialogDescription>
              {editRule?.id} — edits are marked user-edited and will not be overwritten by coding
              root imports.
            </DialogDescription>
          </DialogHeader>
          {ruleFormFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRule(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submitEdit()} disabled={saving}>
              {saving ? <Spinner className="size-4" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
