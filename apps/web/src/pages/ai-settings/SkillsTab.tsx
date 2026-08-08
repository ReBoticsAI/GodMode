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
  approveAiSkill,
  createAiSkill,
  deleteAiSkill,
  fetchAiSkills,
  importWorkspaceKnowledge,
  rejectAiSkill,
  updateAiSkillContent,
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
  SourceBadge,
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
      <SourceBadge sourcePluginId={skill.sourcePluginId} userEdited={skill.userEdited} />
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

type SkillFormState = {
  name: string;
  description: string;
  body: string;
};

const emptySkillForm = (): SkillFormState => ({
  name: "",
  description: "",
  body: "",
});

export function SkillsTab({ visible = true }: { visible?: boolean }) {
  const { activeAgentId } = useIntelligence();
  const [skills, setSkills] = useState<AiSkill[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<KnowledgeStatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editSkill, setEditSkill] = useState<AiSkill | null>(null);
  const [form, setForm] = useState<SkillFormState>(emptySkillForm);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    fetchAiSkills(true, activeAgentId)
      .then((r) => setSkills(r.skills))
      .catch((err) => {
        setSkills([]);
        toast.error(
          err instanceof Error
            ? `Failed to load skills: ${err.message}`
            : "Failed to load skills"
        );
      });
  }, [activeAgentId]);

  // Reload when visible so a hung-Bridge empty state does not stick after recovery.
  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible, load]);

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

  const openCreate = () => {
    setForm(emptySkillForm());
    setCreateOpen(true);
  };

  const openEdit = (skill: AiSkill) => {
    setForm({
      name: skill.name,
      description: skill.description,
      body: skill.body ?? "",
    });
    setEditSkill(skill);
  };

  const submitCreate = async () => {
    const name = form.name.trim();
    const description = form.description.trim();
    const body = form.body.trim();
    if (!name || !body) {
      toast.error("Name and body are required");
      return;
    }
    setSaving(true);
    try {
      await createAiSkill({
        name,
        description,
        body,
        agentId: activeAgentId,
      });
      toast.success("Skill created");
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create skill");
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!editSkill) return;
    const name = form.name.trim();
    const description = form.description.trim();
    const body = form.body.trim();
    if (!name || !body) {
      toast.error("Name and body are required");
      return;
    }
    setSaving(true);
    try {
      await updateAiSkillContent(editSkill.id, {
        name,
        description,
        body,
        agentId: activeAgentId,
      });
      toast.success("Skill updated");
      setEditSkill(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update skill");
    } finally {
      setSaving(false);
    }
  };

  const removeSkill = async (skill: AiSkill) => {
    if (!window.confirm(`Delete skill "${skill.name}"?`)) return;
    try {
      await deleteAiSkill(skill.id, activeAgentId);
      toast.success("Skill deleted");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete skill");
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


  const skillFormFields = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Name</Label>
        <Input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Skill id / display name"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Description</Label>
        <Input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="One-line summary for the skills index"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Body</Label>
        <Textarea
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          placeholder="Full skill instructions (markdown)"
          rows={8}
          className="font-mono text-xs"
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
              <CardTitle className="text-sm">Skills overview</CardTitle>
              <CardDescription className="text-[11px]">
                DB-backed instruction bundles for this agent. Prefer editing skills here in
                Knowledge; AGENTS.md and <code className="text-[10px]">.cursor/skills</code> are
                bootstrap imports from the coding root or your coding root.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => void runImport()} disabled={importing}>
                {importing ? <Spinner className="size-3.5" /> : <DownloadIcon className="size-3.5" />}
                Import from coding root
              </Button>
              <Button type="button" size="sm" onClick={openCreate}>
                <PlusIcon className="size-3.5" />
                New skill
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
          {active.map((s) => {
            const owned = !isInherited(s.agentId, activeAgentId);
            return (
              <div key={s.id} className="rounded-lg border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {owned && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title="Edit skill"
                          onClick={() => openEdit(s)}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title="Delete skill"
                          onClick={() => void removeSkill(s)}
                        >
                          <Trash2Icon className="size-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={(v) => {
                        void updateAiSkillState(s.id, v, activeAgentId).then(load);
                      }}
                    />
                  </div>
                </div>
                <SkillMetaBadges skill={s} activeAgentId={activeAgentId} />
                <VersionMeta version={s.version} updatedAt={s.updatedAt} />
                {s.body && (
                  <pre className="mt-2 max-h-24 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10px]">
                    {s.body.slice(0, 300)}
                    {s.body.length > 300 ? "…" : ""}
                  </pre>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
            <DialogDescription>
              Create a native skill for this agent. It is stored in the knowledge database, not in
              the coding root.
            </DialogDescription>
          </DialogHeader>
          {skillFormFields}
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

      <Dialog open={editSkill != null} onOpenChange={(open) => !open && setEditSkill(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit skill</DialogTitle>
            <DialogDescription>
              {editSkill?.id} — edits are marked user-edited and will not be overwritten by coding
              root imports.
            </DialogDescription>
          </DialogHeader>
          {skillFormFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSkill(null)} disabled={saving}>
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
