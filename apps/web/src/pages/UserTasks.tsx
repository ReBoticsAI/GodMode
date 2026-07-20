import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderGit2,
  FolderKanban,
  Link2Off,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { ProjectsBoard } from "@/components/intelligence/projects/ProjectsBoard";
import { Page, PageHeader } from "@/components/PageHeader";
import { ShareDialog } from "@/components/ShareDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenant } from "@/lib/tenant-context";
import {
  archiveUserTaskBoard,
  createUserTaskBoard,
  fetchGithubIntegrationStatus,
  fetchGithubProjectMeta,
  fetchGithubProjectsList,
  fetchUserProjects,
  linkUserBoardGithub,
  renameUserTaskBoard,
  syncUserBoardGithub,
  unlinkUserBoardGithub,
  updateUserBoardStatusMap,
  type UserTaskBoard,
} from "@/api";
import { toast } from "sonner";

const COLUMN_LABELS: Array<{ id: string; label: string }> = [
  { id: "backlog", label: "Backlog" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

export default function UserTasksPage() {
  const { user } = useTenant();
  const userId = user?.id ?? "";
  const [boards, setBoards] = useState<UserTaskBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardName, setBoardName] = useState("");
  const [ghProjects, setGhProjects] = useState<
    Array<{ id: string; title: string; url: string; owner: string }>
  >([]);
  const [ghConnected, setGhConnected] = useState(false);
  const [linkProjectId, setLinkProjectId] = useState("");
  const [statusOptions, setStatusOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [boardKey, setBoardKey] = useState(0);

  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? null,
    [boards, activeBoardId]
  );

  const reloadBoards = useCallback(async () => {
    if (!userId) return;
    const snap = await fetchUserProjects(userId, activeBoardId ?? undefined);
    setBoards((snap.projects ?? []) as UserTaskBoard[]);
    const nextId =
      snap.activeProjectId ??
      activeBoardId ??
      snap.projects?.[0]?.id ??
      null;
    setActiveBoardId(nextId);
  }, [userId, activeBoardId]);

  useEffect(() => {
    void reloadBoards().catch((err) =>
      toast.error(err instanceof Error ? err.message : "Failed to load boards")
    );
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps -- initial load

  useEffect(() => {
    void fetchGithubIntegrationStatus()
      .then((s) => setGhConnected(s.connected))
      .catch(() => setGhConnected(false));
  }, []);

  const loadStatusMeta = async (projectNodeId: string, existingMapJson?: string | null) => {
    const meta = await fetchGithubProjectMeta(projectNodeId);
    setStatusOptions(meta.statusOptions);
    let map = meta.defaultStatusMap;
    if (existingMapJson) {
      try {
        map = { ...map, ...(JSON.parse(existingMapJson) as Record<string, string>) };
      } catch {
        /* keep default */
      }
    }
    setStatusMap(map);
  };

  const createBoard = async () => {
    setBusy(true);
    try {
      const { project } = await createUserTaskBoard(newName.trim() || "New board");
      setNewName("");
      setNewOpen(false);
      setActiveBoardId(project.id);
      await reloadBoards();
      setBoardKey((k) => k + 1);
      toast.success("Board created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create board");
    } finally {
      setBusy(false);
    }
  };

  const openSettings = async () => {
    setSettingsOpen(true);
    setBoardName(activeBoard?.name ?? "");
    setStatusOptions([]);
    setStatusMap({});
    if (ghConnected) {
      try {
        const { projects } = await fetchGithubProjectsList();
        setGhProjects(projects);
        const nodeId = activeBoard?.github_project_node_id ?? "";
        setLinkProjectId(nodeId);
        if (nodeId) {
          await loadStatusMeta(nodeId, activeBoard?.github_status_map_json);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not list GitHub Projects"
        );
      }
    }
  };

  const saveRename = async () => {
    if (!activeBoardId || !boardName.trim()) return;
    setBusy(true);
    try {
      await renameUserTaskBoard(activeBoardId, boardName.trim());
      await reloadBoards();
      toast.success("Board renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  };

  const linkGithub = async () => {
    if (!activeBoardId || !linkProjectId) return;
    setBusy(true);
    try {
      await linkUserBoardGithub(activeBoardId, {
        projectNodeId: linkProjectId,
        statusMap: Object.keys(statusMap).length ? statusMap : undefined,
      });
      await reloadBoards();
      await loadStatusMeta(linkProjectId);
      toast.success("Linked to GitHub Project");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Link failed");
    } finally {
      setBusy(false);
    }
  };

  const saveStatusMap = async () => {
    if (!activeBoardId) return;
    setBusy(true);
    try {
      await updateUserBoardStatusMap(activeBoardId, statusMap);
      await reloadBoards();
      toast.success("Column ↔ Status map saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save map");
    } finally {
      setBusy(false);
    }
  };

  const unlinkGithub = async () => {
    if (!activeBoardId) return;
    setBusy(true);
    try {
      await unlinkUserBoardGithub(activeBoardId);
      await reloadBoards();
      setLinkProjectId("");
      setStatusOptions([]);
      setStatusMap({});
      toast.success("Unlinked GitHub Project");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unlink failed");
    } finally {
      setBusy(false);
    }
  };

  const syncGithub = async () => {
    if (!activeBoardId) return;
    setBusy(true);
    try {
      const res = await syncUserBoardGithub(activeBoardId);
      setBoardKey((k) => k + 1);
      await reloadBoards();
      toast.success(
        `Synced ${res.pulled} items (${res.created} new, ${res.updated} updated)`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const archiveBoard = async () => {
    if (!activeBoardId) return;
    setBusy(true);
    try {
      await archiveUserTaskBoard(activeBoardId);
      setActiveBoardId(null);
      await reloadBoards();
      setSettingsOpen(false);
      setBoardKey((k) => k + 1);
      toast.success("Board archived");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Tasks"
        description="Personal kanban boards — create as many as you need; optionally sync one with a GitHub Project."
        actions={
          userId ? (
            <ShareDialog
              resourceKind="user_tasks"
              resourceId={userId}
              resourceLabel="My Tasks"
            />
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={activeBoardId ?? undefined}
          onValueChange={(v) => {
            if (!v) return;
            setActiveBoardId(v);
            setBoardKey((k) => k + 1);
          }}
        >
          <SelectTrigger className="h-8 w-[220px] text-xs">
            <SelectValue placeholder="Select board" />
          </SelectTrigger>
          <SelectContent>
            {boards.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
                {b.sync_enabled ? " · GitHub" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          New board
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={!activeBoardId}
          onClick={() => void openSettings()}
        >
          <Settings2 className="mr-1 h-3.5 w-3.5" />
          Board
        </Button>
        {activeBoard?.sync_enabled ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy}
            onClick={() => void syncGithub()}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Sync GitHub
          </Button>
        ) : null}
        {activeBoard?.github_project_url ? (
          <a
            href={activeBoard.github_project_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted"
          >
            <FolderGit2 className="h-3.5 w-3.5" />
            Open on GitHub
          </a>
        ) : null}
      </div>

      <div className="flex min-h-[560px] flex-1 flex-col rounded-lg border bg-card/30 p-3">
        {activeBoardId ? (
          <ProjectsBoard
            key={`${activeBoardId}-${boardKey}`}
            scope={{ kind: "user", userId }}
            projectId={activeBoardId}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <FolderKanban className="h-8 w-8 opacity-40" />
            Create a board to get started
          </div>
        )}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
            <DialogDescription>
              Another kanban on your personal Tasks. Link GitHub later in board
              settings if you want.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-name">Name</Label>
            <Input
              id="board-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Family, Roadmap, …"
            />
          </div>
          <DialogFooter>
            <Button disabled={busy} onClick={() => void createBoard()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{activeBoard?.name ?? "Board"} settings</DialogTitle>
            <DialogDescription>
              Rename this board or link it to a GitHub Project you can access.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rename-board">Name</Label>
              <div className="flex gap-2">
                <Input
                  id="rename-board"
                  value={boardName}
                  onChange={(e) => setBoardName(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !boardName.trim()}
                  onClick={() => void saveRename()}
                >
                  Save
                </Button>
              </div>
            </div>

            {!ghConnected ? (
              <p className="text-muted-foreground">
                GitHub is not connected. Open Settings → Connect GitHub, then
                return here.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>GitHub Project</Label>
                  <Select
                    value={linkProjectId || undefined}
                    onValueChange={(v) => {
                      const id = v ?? "";
                      setLinkProjectId(id);
                      if (id) {
                        void loadStatusMeta(id).catch((err) =>
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "Could not load project fields"
                          )
                        );
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a project" />
                    </SelectTrigger>
                    <SelectContent>
                      {ghProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.owner}/{p.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {statusOptions.length > 0 ? (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <Label className="text-xs text-muted-foreground">
                      Column ↔ GitHub Status
                    </Label>
                    {COLUMN_LABELS.map((col) => (
                      <div
                        key={col.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="text-xs w-24 shrink-0">{col.label}</span>
                        <Select
                          value={statusMap[col.id] || undefined}
                          onValueChange={(v) =>
                            setStatusMap((m) => ({
                              ...m,
                              [col.id]: v ?? "",
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Status option" />
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                    {activeBoard?.sync_enabled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void saveStatusMap()}
                      >
                        Save status map
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !linkProjectId}
                    onClick={() => void linkGithub()}
                  >
                    <FolderGit2 className="mr-1 h-3.5 w-3.5" />
                    Link & enable sync
                  </Button>
                  {activeBoard?.sync_enabled ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void unlinkGithub()}
                    >
                      <Link2Off className="mr-1 h-3.5 w-3.5" />
                      Unlink
                    </Button>
                  ) : null}
                </div>
              </>
            )}
            {activeBoard && !activeBoard.id.startsWith("user-") ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() => void archiveBoard()}
              >
                Archive board
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
