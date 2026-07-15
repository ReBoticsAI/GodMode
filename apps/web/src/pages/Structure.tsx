import { useEffect, useState } from "react";
import {
  CheckIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  createStructureDivision,
  createStructureNode,
  createStructurePage,
  deleteStructureDepartment,
  deleteStructureDivision,
  deleteStructurePage,
  fetchAiAgents,
  fetchAgentAssignments,
  setAgentAssignment,
  updateStructureDepartment,
  updateStructureDivision,
  updateStructurePage,
  type AiAgent,
  type AiAgentAssignment,
  type AiAssignmentRole,
} from "../api";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { IconPicker } from "@/components/IconPicker";
import { useStructure } from "@/lib/structure-context";
import { iconByName } from "@/lib/icon-lookup";
import type {
  DepartmentNode,
  DivisionNode,
  PageNode,
} from "@/lib/navigation";

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

const isValidSlug = (s: string): boolean => /^[a-z][a-z0-9-]*$/.test(s);

export default function Structure() {
  const { departments, loading, error, reload } = useStructure();
  const [tab, setTab] = useState("departments");
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedDiv, setSelectedDiv] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedDept && departments[0]) setSelectedDept(departments[0].id);
  }, [departments, selectedDept]);

  const dept = departments.find((d) => d.id === selectedDept);
  useEffect(() => {
    if (!dept) {
      setSelectedDiv(null);
      return;
    }
    if (!selectedDiv || !dept.divisions.find((d) => d.id === selectedDiv)) {
      setSelectedDiv(dept.divisions[0]?.id ?? null);
    }
  }, [dept, selectedDiv]);

  const division = dept?.divisions.find((d) => d.id === selectedDiv) ?? null;

  return (
    <Page>
      <PageHeader
        title="Structure"
        description="Manage departments, divisions, and pages that appear in the sidebar."
        actions={
          <Button variant="outline" onClick={() => reload()}>
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        }
      />

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">
              Failed to load structure
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="divisions">Divisions</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
        </TabsList>

        <TabsContent value="departments">
          <DepartmentsPanel
            departments={departments}
            loading={loading}
            reload={reload}
          />
        </TabsContent>

        <TabsContent value="divisions">
          <DivisionsPanel
            departments={departments}
            selectedDept={selectedDept}
            setSelectedDept={setSelectedDept}
            reload={reload}
          />
        </TabsContent>

        <TabsContent value="pages">
          <PagesPanel
            departments={departments}
            selectedDept={selectedDept}
            setSelectedDept={setSelectedDept}
            selectedDiv={selectedDiv}
            setSelectedDiv={setSelectedDiv}
            division={division}
            reload={reload}
          />
        </TabsContent>

        <TabsContent value="agents">
          <AgentsPanel departments={departments} loading={loading} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

/* ---------- Agents tab ---------- */

const INHERIT_VALUE = "__inherit__";

function scopeKey(scopeType: AiAgentAssignment["scope_type"], scopeId: string): string {
  return `${scopeType}|${scopeId}`;
}

function AgentsPanel({
  departments,
  loading,
}: {
  departments: DepartmentNode[];
  loading: boolean;
}) {
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [roles, setRoles] = useState<Map<string, AiAssignmentRole>>(new Map());
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const load = async () => {
    try {
      const [agentsRes, assignRes] = await Promise.all([
        fetchAiAgents(),
        fetchAgentAssignments(),
      ]);
      setAgents(agentsRes.agents);
      const map = new Map<string, string>();
      const roleMap = new Map<string, AiAssignmentRole>();
      for (const a of assignRes.assignments) {
        map.set(scopeKey(a.scope_type, a.scope_id), a.agent_id);
        roleMap.set(scopeKey(a.scope_type, a.scope_id), a.role);
      }
      setAssignments(map);
      setRoles(roleMap);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agentName = (id: string): string =>
    agents.find((a) => a.id === id)?.name ?? id;

  const explicitAgent = (
    scopeType: AiAgentAssignment["scope_type"],
    scopeId: string
  ): string | undefined => assignments.get(scopeKey(scopeType, scopeId));

  const explicitRole = (
    scopeType: AiAgentAssignment["scope_type"],
    scopeId: string
  ): AiAssignmentRole | undefined => roles.get(scopeKey(scopeType, scopeId));

  // Mirror of the backend walk: page -> division -> department -> root.
  const resolve = (
    departmentId: string,
    divisionId?: string,
    pageId?: string
  ): { agentId: string; inheritedFrom: string } => {
    if (divisionId && pageId) {
      const p = explicitAgent("page", `${departmentId}/${divisionId}/${pageId}`);
      if (p) return { agentId: p, inheritedFrom: "page" };
    }
    if (divisionId) {
      const d = explicitAgent("division", `${departmentId}/${divisionId}`);
      if (d) return { agentId: d, inheritedFrom: "division" };
    }
    const dep = explicitAgent("department", departmentId);
    if (dep) return { agentId: dep, inheritedFrom: "department" };
    return { agentId: "intelligence", inheritedFrom: "root" };
  };

  const change = async (
    scopeType: AiAgentAssignment["scope_type"],
    scopeId: string,
    value: string
  ) => {
    const agentId = value === INHERIT_VALUE ? null : value;
    const role = agentId
      ? roles.get(scopeKey(scopeType, scopeId)) ?? "owner"
      : undefined;
    setBusy(true);
    try {
      await setAgentAssignment(scopeType, scopeId, agentId, role);
      setAssignments((prev) => {
        const next = new Map(prev);
        if (agentId) next.set(scopeKey(scopeType, scopeId), agentId);
        else next.delete(scopeKey(scopeType, scopeId));
        return next;
      });
      setRoles((prev) => {
        const next = new Map(prev);
        if (agentId && role) next.set(scopeKey(scopeType, scopeId), role);
        else next.delete(scopeKey(scopeType, scopeId));
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign agent");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (
    scopeType: AiAgentAssignment["scope_type"],
    scopeId: string,
    role: AiAssignmentRole
  ) => {
    const agentId = assignments.get(scopeKey(scopeType, scopeId));
    if (!agentId) return;
    setBusy(true);
    try {
      await setAgentAssignment(scopeType, scopeId, agentId, role);
      setRoles((prev) => {
        const next = new Map(prev);
        next.set(scopeKey(scopeType, scopeId), role);
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set role");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent assignment</CardTitle>
        <CardDescription>
          Assign a Intelligence subagent to each department, division, and page. Pages
          inherit from their division, divisions from their department, and
          departments fall back to the root Intelligence agent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(loading || !ready) && departments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading\u2026
          </p>
        ) : (
          <div className="space-y-6">
            {departments.map((dept) => {
              const deptExplicit = explicitAgent("department", dept.id);
              return (
                <div key={dept.id} className="rounded-lg border">
                  <AgentScopeRow
                    label={dept.label}
                    iconName={dept.icon}
                    depth={0}
                    explicit={deptExplicit}
                    inherited={
                      deptExplicit ? undefined : resolve(dept.id).agentId
                    }
                    agents={agents}
                    agentName={agentName}
                    busy={busy}
                    role={explicitRole("department", dept.id)}
                    onChange={(v) => change("department", dept.id, v)}
                    onRoleChange={(r) => changeRole("department", dept.id, r)}
                  />
                  {dept.divisions.map((div) => {
                    const divScope = `${dept.id}/${div.id}`;
                    const divExplicit = explicitAgent("division", divScope);
                    return (
                      <div key={div.id}>
                        <AgentScopeRow
                          label={div.label}
                          iconName={div.icon}
                          depth={1}
                          explicit={divExplicit}
                          inherited={
                            divExplicit
                              ? undefined
                              : resolve(dept.id, div.id).agentId
                          }
                          agents={agents}
                          agentName={agentName}
                          busy={busy}
                          role={explicitRole("division", divScope)}
                          onChange={(v) => change("division", divScope, v)}
                          onRoleChange={(r) => changeRole("division", divScope, r)}
                        />
                        {div.pages.map((page) => {
                          const pageScope = `${dept.id}/${div.id}/${page.id}`;
                          const pageExplicit = explicitAgent("page", pageScope);
                          return (
                            <AgentScopeRow
                              key={page.id}
                              label={page.label}
                              iconName={page.icon}
                              depth={2}
                              explicit={pageExplicit}
                              inherited={
                                pageExplicit
                                  ? undefined
                                  : resolve(dept.id, div.id, page.id).agentId
                              }
                              agents={agents}
                              agentName={agentName}
                              busy={busy}
                              role={explicitRole("page", pageScope)}
                              onChange={(v) => change("page", pageScope, v)}
                              onRoleChange={(r) => changeRole("page", pageScope, r)}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const ASSIGNMENT_ROLES: AiAssignmentRole[] = ["viewer", "editor", "owner"];

function AgentScopeRow({
  label,
  iconName,
  depth,
  explicit,
  inherited,
  agents,
  agentName,
  busy,
  role,
  onChange,
  onRoleChange,
}: {
  label: string;
  iconName: string;
  depth: number;
  explicit: string | undefined;
  inherited: string | undefined;
  agents: AiAgent[];
  agentName: (id: string) => string;
  busy: boolean;
  role: AiAssignmentRole | undefined;
  onChange: (value: string) => void;
  onRoleChange: (role: AiAssignmentRole) => void;
}) {
  const Icon = iconByName(iconName);
  return (
    <div
      className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
      style={{ paddingLeft: 12 + depth * 24 }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className={depth === 0 ? "font-medium" : "text-sm"}>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {explicit && (
          <Select
            value={role ?? "owner"}
            onValueChange={(v) => onRoleChange(v as AiAssignmentRole)}
            disabled={busy}
          >
            <SelectTrigger className="w-28" title="Platform Builder role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ASSIGNMENT_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        <Select
          value={explicit ?? ""}
          onValueChange={(v) => onChange(v ?? INHERIT_VALUE)}
          disabled={busy}
        >
          <SelectTrigger className="w-60">
            <SelectValue
              placeholder={
                inherited
                  ? `Inherits: ${agentName(inherited)}`
                  : "Select agent"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={INHERIT_VALUE}>Clear / inherit</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/* ---------- Departments tab ---------- */

function DepartmentsPanel({
  departments,
  loading,
  reload,
}: {
  departments: DepartmentNode[];
  loading: boolean;
  reload: () => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Departments</CardTitle>
          <CardDescription>
            Top-level groupings shown in the sidebar department picker.
          </CardDescription>
        </div>
        <CreateDepartmentDialog reload={reload} />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Icon</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Divisions</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && departments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Loading\u2026
                </TableCell>
              </TableRow>
            ) : (
              departments.map((d) => (
                <DepartmentRow key={d.id} department={d} reload={reload} />
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DepartmentRow({
  department,
  reload,
}: {
  department: DepartmentNode;
  reload: () => Promise<void>;
}) {
  const Icon = iconByName(department.icon);
  return (
    <TableRow>
      <TableCell>
        <Icon className="size-4" />
      </TableCell>
      <TableCell>
        <InlineLabelEditor
          value={department.label}
          onSave={async (next) => {
            await updateStructureDepartment(department.id, { label: next });
            await reload();
          }}
        />
        {department.builtIn && (
          <Badge variant="outline" className="ml-2 gap-1">
            <LockIcon className="size-3" /> built-in
          </Badge>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {department.id}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {department.basePath}
      </TableCell>
      <TableCell>{department.divisions.length}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <IconEditButton
            value={department.icon}
            onChange={async (next) => {
              await updateStructureDepartment(department.id, { icon: next });
              await reload();
            }}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={department.builtIn}
            onClick={async () => {
              if (
                !confirm(
                  `Delete department "${department.label}" and all of its divisions and pages?`
                )
              )
                return;
              try {
                await deleteStructureDepartment(department.id);
                toast.success("Department deleted");
                await reload();
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to delete"
                );
              }
            }}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreateDepartmentDialog({
  reload,
}: {
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [icon, setIcon] = useState("briefcase");
  const [busy, setBusy] = useState(false);
  const [touchedId, setTouchedId] = useState(false);

  const reset = () => {
    setLabel("");
    setId("");
    setIcon("briefcase");
    setTouchedId(false);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await createStructureNode({ id, label, icon });
      toast.success("Department created");
      reset();
      setOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" /> New department
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New department</DialogTitle>
          <DialogDescription>
            Departments appear in the sidebar department picker.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="dept-label">Label</Label>
            <Input
              id="dept-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!touchedId) setId(slugify(e.target.value));
              }}
              placeholder="Marketing"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="dept-id">URL slug</Label>
            <Input
              id="dept-id"
              value={id}
              onChange={(e) => {
                setTouchedId(true);
                setId(e.target.value);
              }}
              placeholder="marketing"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits, hyphens. Used as the URL prefix
              <code className="mx-1 rounded bg-muted px-1 py-0.5">
                /{id || "your-slug"}
              </code>
              .
            </p>
          </div>
          <div className="grid gap-1">
            <Label>Icon</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !label.trim() || !isValidSlug(id)}
          >
            {busy ? "Creating\u2026" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Divisions tab ---------- */

function DivisionsPanel({
  departments,
  selectedDept,
  setSelectedDept,
  reload,
}: {
  departments: DepartmentNode[];
  selectedDept: string | null;
  setSelectedDept: (s: string | null) => void;
  reload: () => Promise<void>;
}) {
  const dept = departments.find((d) => d.id === selectedDept);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Divisions</CardTitle>
            <CardDescription>
              Divisions live under a department; each owns its own set of pages.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Department</Label>
            <Select value={selectedDept ?? ""} onValueChange={setSelectedDept}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Pick a department" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {dept && <CreateDivisionDialog dept={dept} reload={reload} />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!dept ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Select a department to manage its divisions.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Icon</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Right sidebar</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dept.divisions.map((div) => (
                <DivisionRow
                  key={div.id}
                  dept={dept}
                  division={div}
                  reload={reload}
                />
              ))}
              {dept.divisions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No divisions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function DivisionRow({
  dept,
  division,
  reload,
}: {
  dept: DepartmentNode;
  division: DivisionNode;
  reload: () => Promise<void>;
}) {
  const Icon = iconByName(division.icon);
  return (
    <TableRow>
      <TableCell>
        <Icon className="size-4" />
      </TableCell>
      <TableCell>
        <InlineLabelEditor
          value={division.label}
          onSave={async (next) => {
            await updateStructureDivision(dept.id, division.id, { label: next });
            await reload();
          }}
        />
        {division.builtIn && (
          <Badge variant="outline" className="ml-2 gap-1">
            <LockIcon className="size-3" /> built-in
          </Badge>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {division.id}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {division.basePath}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            checked={division.rightSidebar === "price"}
            onCheckedChange={async (checked) => {
              try {
                await updateStructureDivision(dept.id, division.id, {
                  rightSidebar: checked ? "price" : null,
                });
                await reload();
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to update"
                );
              }
            }}
          />
          <span className="text-xs text-muted-foreground">Price sidebar</span>
        </div>
      </TableCell>
      <TableCell>{division.pages.length}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <IconEditButton
            value={division.icon}
            onChange={async (next) => {
              await updateStructureDivision(dept.id, division.id, { icon: next });
              await reload();
            }}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={division.builtIn}
            onClick={async () => {
              if (
                !confirm(
                  `Delete division "${division.label}" and all of its pages?`
                )
              )
                return;
              try {
                await deleteStructureDivision(dept.id, division.id);
                toast.success("Division deleted");
                await reload();
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to delete"
                );
              }
            }}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreateDivisionDialog({
  dept,
  reload,
}: {
  dept: DepartmentNode;
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [icon, setIcon] = useState("folder");
  const [rightSidebar, setRightSidebar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touchedId, setTouchedId] = useState(false);

  const reset = () => {
    setLabel("");
    setId("");
    setIcon("folder");
    setRightSidebar(false);
    setTouchedId(false);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await createStructureDivision(dept.id, {
        id,
        label,
        icon,
        rightSidebar: rightSidebar ? "price" : null,
      });
      toast.success("Division created");
      reset();
      setOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" /> New division
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New division in {dept.label}</DialogTitle>
          <DialogDescription>
            Divisions live at <code>{dept.basePath}/&lt;slug&gt;</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="div-label">Label</Label>
            <Input
              id="div-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!touchedId) setId(slugify(e.target.value));
              }}
              placeholder="Markets"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="div-id">URL slug</Label>
            <Input
              id="div-id"
              value={id}
              onChange={(e) => {
                setTouchedId(true);
                setId(e.target.value);
              }}
              placeholder="markets"
            />
            <p className="text-xs text-muted-foreground">
              Final path:{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {dept.basePath}/{id || "your-slug"}
              </code>
            </p>
          </div>
          <div className="grid gap-1">
            <Label>Icon</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label>Show plugin sidebar</Label>
              <p className="text-xs text-muted-foreground">
                Renders the plugin right sidebar on every page in this division
                when a plugin registers for the <code>price</code> slot.
              </p>
            </div>
            <Switch
              checked={rightSidebar}
              onCheckedChange={setRightSidebar}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !label.trim() || !isValidSlug(id)}
          >
            {busy ? "Creating\u2026" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Pages tab ---------- */

function PagesPanel({
  departments,
  selectedDept,
  setSelectedDept,
  selectedDiv,
  setSelectedDiv,
  division,
  reload,
}: {
  departments: DepartmentNode[];
  selectedDept: string | null;
  setSelectedDept: (s: string | null) => void;
  selectedDiv: string | null;
  setSelectedDiv: (s: string | null) => void;
  division: DivisionNode | null;
  reload: () => Promise<void>;
}) {
  const dept = departments.find((d) => d.id === selectedDept);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Pages</CardTitle>
            <CardDescription>
              Pages appear in the sidebar nav for the selected division.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedDept ?? ""} onValueChange={setSelectedDept}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={selectedDiv ?? ""}
              onValueChange={setSelectedDiv}
              disabled={!dept || dept.divisions.length === 0}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Division" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(dept?.divisions ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {dept && division && (
              <CreatePageDialog
                dept={dept}
                division={division}
                reload={reload}
              />
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!division ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Select a department and division to manage their pages.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Icon</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {division.pages.map((page) => (
                <PageRow
                  key={page.id}
                  dept={dept!}
                  division={division}
                  page={page}
                  reload={reload}
                />
              ))}
              {division.pages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No pages yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PageRow({
  dept,
  division,
  page,
  reload,
}: {
  dept: DepartmentNode;
  division: DivisionNode;
  page: PageNode;
  reload: () => Promise<void>;
}) {
  const Icon = iconByName(page.icon);
  return (
    <TableRow>
      <TableCell>
        <Icon className="size-4" />
      </TableCell>
      <TableCell>
        <InlineLabelEditor
          value={page.label}
          onSave={async (next) => {
            await updateStructurePage(dept.id, division.id, page.id, {
              label: next,
            });
            await reload();
          }}
        />
        {page.builtIn && (
          <Badge variant="outline" className="ml-2 gap-1">
            <LockIcon className="size-3" /> built-in
          </Badge>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {page.segment === "" ? "(index)" : page.segment}
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{page.kind}</Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <IconEditButton
            value={page.icon}
            onChange={async (next) => {
              await updateStructurePage(dept.id, division.id, page.id, {
                icon: next,
              });
              await reload();
            }}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={page.builtIn}
            onClick={async () => {
              if (!confirm(`Delete page "${page.label}"?`)) return;
              try {
                await deleteStructurePage(dept.id, division.id, page.id);
                toast.success("Page deleted");
                await reload();
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to delete"
                );
              }
            }}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreatePageDialog({
  dept,
  division,
  reload,
}: {
  dept: DepartmentNode;
  division: DivisionNode;
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [segment, setSegment] = useState("");
  const [icon, setIcon] = useState("folder");
  const [busy, setBusy] = useState(false);
  const [touchedId, setTouchedId] = useState(false);
  const [touchedSeg, setTouchedSeg] = useState(false);

  const reset = () => {
    setLabel("");
    setId("");
    setSegment("");
    setIcon("folder");
    setTouchedId(false);
    setTouchedSeg(false);
  };

  const segValid = segment === "" || /^[a-z0-9-]+$/.test(segment);

  const submit = async () => {
    setBusy(true);
    try {
      await createStructurePage(dept.id, division.id, {
        id,
        label,
        icon,
        segment,
      });
      toast.success("Page created");
      reset();
      setOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" /> New page
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New page in {division.label}</DialogTitle>
          <DialogDescription>
            New pages render a placeholder until you replace them in code.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="page-label">Label</Label>
            <Input
              id="page-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!touchedId) setId(slugify(e.target.value));
                if (!touchedSeg) setSegment(slugify(e.target.value));
              }}
              placeholder="Analytics"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="page-id">ID</Label>
            <Input
              id="page-id"
              value={id}
              onChange={(e) => {
                setTouchedId(true);
                setId(e.target.value);
              }}
              placeholder="analytics"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="page-segment">URL segment</Label>
            <Input
              id="page-segment"
              value={segment}
              onChange={(e) => {
                setTouchedSeg(true);
                setSegment(e.target.value);
              }}
              placeholder="analytics"
            />
            <p className="text-xs text-muted-foreground">
              Final path:{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {division.basePath}
                {segment ? `/${segment}` : ""}
              </code>
              {segment === "" && " (index page)"}
            </p>
          </div>
          <div className="grid gap-1">
            <Label>Icon</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !label.trim() || !isValidSlug(id) || !segValid}
          >
            {busy ? "Creating\u2026" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Shared inline editors ---------- */

function InlineLabelEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span>{value}</span>
        <Button
          size="icon-sm"
          variant="ghost"
          className="opacity-50 hover:opacity-100"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          <PencilIcon className="size-3" />
        </Button>
      </span>
    );
  }

  const save = async () => {
    if (!draft.trim() || draft === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-7 w-40"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <Button size="icon-sm" variant="ghost" disabled={busy} onClick={save}>
        <CheckIcon className="size-3" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => setEditing(false)}
      >
        <XIcon className="size-3" />
      </Button>
    </span>
  );
}

function IconEditButton({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => Promise<void>;
}) {
  const Icon = iconByName(value);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(value);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="icon-sm" variant="ghost" />}
      >
        <Icon className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change icon</DialogTitle>
        </DialogHeader>
        <IconPicker value={pending} onChange={setPending} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              try {
                await onChange(pending);
                setOpen(false);
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to update"
                );
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
