import { useCallback, useEffect, useState } from "react";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  FilePlusIcon,
  PencilIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createCodingDir,
  createCodingFile,
  deleteCodingPath,
  fetchCodingFile,
  fetchCodingTree,
  renameCodingPath,
  saveCodingFile,
  ApiError,
  type CodingTreeEntry,
} from "@/api";
import { toast } from "sonner";
import { CodingTerminalPanel } from "./CodingTerminalPanel";

type DialogMode = "new-file" | "new-folder" | "rename" | "delete" | null;

function TreeNode({
  entry,
  depth,
  selectedPath,
  onSelectFile,
  onRefreshParent,
}: {
  entry: CodingTreeEntry;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onRefreshParent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<CodingTreeEntry[] | null>(null);
  const [loadingKids, setLoadingKids] = useState(false);

  const loadChildren = useCallback(async () => {
    setLoadingKids(true);
    try {
      const res = await fetchCodingTree(entry.path);
      setChildren(res.entries);
    } catch (err) {
      toast.error((err as Error).message);
      setChildren([]);
    } finally {
      setLoadingKids(false);
    }
  }, [entry.path]);

  useEffect(() => {
    if (open && children === null) void loadChildren();
  }, [open, children, loadChildren]);

  if (entry.type === "file") {
    return (
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted",
          selectedPath === entry.path && "bg-muted font-medium"
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelectFile(entry.path)}
      >
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{entry.name}</span>
      </button>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{entry.name}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {loadingKids && (
          <div
            className="px-2 py-1 text-xs text-muted-foreground"
            style={{ paddingLeft: 20 + depth * 12 }}
          >
            Loading…
          </div>
        )}
        {children?.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            onRefreshParent={() => {
              void loadChildren();
              onRefreshParent();
            }}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function CodingWorkspacePage() {
  const [rootEntries, setRootEntries] = useState<CodingTreeEntry[]>([]);
  const [codingRoot, setCodingRoot] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [treeKey, setTreeKey] = useState(0);

  const [dialog, setDialog] = useState<DialogMode>(null);
  const [dialogValue, setDialogValue] = useState("");

  const dirty = selectedPath !== null && content !== savedContent;

  const refreshTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCodingTree(".");
      setRootEntries(res.entries);
      setCodingRoot(res.root);
      setDenied(false);
      setTreeKey((k) => k + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setDenied(true);
      toast.error((err as Error).message);
      setRootEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  const openFile = useCallback(async (path: string) => {
    if (dirty) {
      const ok = window.confirm("Discard unsaved changes?");
      if (!ok) return;
    }
    setFileLoading(true);
    setSelectedPath(path);
    try {
      const res = await fetchCodingFile(path);
      setContent(res.content);
      setSavedContent(res.content);
    } catch (err) {
      toast.error((err as Error).message);
      setSelectedPath(null);
      setContent("");
      setSavedContent("");
    } finally {
      setFileLoading(false);
    }
  }, [dirty]);

  const save = useCallback(async () => {
    if (!selectedPath) return;
    try {
      await saveCodingFile(selectedPath, content);
      setSavedContent(content);
      toast.success("Saved");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [selectedPath, content]);

  const openDialog = (mode: DialogMode) => {
    if (mode === "rename" && selectedPath) {
      setDialogValue(selectedPath);
    } else if (mode === "new-file") {
      const base = selectedPath?.includes("/")
        ? selectedPath.slice(0, selectedPath.lastIndexOf("/") + 1)
        : "";
      setDialogValue(`${base}untitled.txt`);
    } else if (mode === "new-folder") {
      setDialogValue("new-folder");
    } else {
      setDialogValue(selectedPath ?? "");
    }
    setDialog(mode);
  };

  const runDialog = async () => {
    try {
      if (dialog === "new-file") {
        const path = dialogValue.trim().replace(/\\/g, "/");
        await createCodingFile(path, "");
        toast.success("File created");
        await refreshTree();
        await openFile(path);
      } else if (dialog === "new-folder") {
        const path = dialogValue.trim().replace(/\\/g, "/");
        await createCodingDir(path);
        toast.success("Folder created");
        await refreshTree();
      } else if (dialog === "rename" && selectedPath) {
        const to = dialogValue.trim().replace(/\\/g, "/");
        await renameCodingPath(selectedPath, to);
        toast.success("Renamed");
        setSelectedPath(to);
        setSavedContent(content);
        await refreshTree();
      } else if (dialog === "delete" && selectedPath) {
        await deleteCodingPath(selectedPath);
        toast.success("Deleted");
        setSelectedPath(null);
        setContent("");
        setSavedContent("");
        await refreshTree();
      }
      setDialog(null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (denied) {
    return (
      <Page>
        <PageHeader title="Coding" description="Browse and edit the coding workspace." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Coding disabled</EmptyTitle>
            <EmptyDescription>
              This installation has SaaS code access turned off. File browse and
              edit stay blocked until platform policy allows them.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Coding"
        description="Browse files and run sandboxed shell commands in the active coding root."
      />
      <Tabs defaultValue="files" className="flex flex-col gap-4">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="mt-0">
          <div className="flex min-h-[28rem] flex-col gap-4 md:flex-row md:items-stretch">
            <aside className="flex w-full shrink-0 flex-col gap-2 rounded-xl border bg-card md:w-64">
              <div className="flex items-center gap-1 border-b p-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => openDialog("new-file")}
                >
                  <FilePlusIcon data-icon="inline-start" />
                  File
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => openDialog("new-folder")}
                >
                  <FolderPlusIcon data-icon="inline-start" />
                  Folder
                </Button>
              </div>
              <ScrollArea className="h-64 md:h-[calc(100%-3rem)]">
                <div key={treeKey} className="p-1">
                  {loading && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      Loading tree…
                    </p>
                  )}
                  {!loading && rootEntries.length === 0 && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      Empty workspace
                    </p>
                  )}
                  {rootEntries.map((entry) => (
                    <TreeNode
                      key={entry.path}
                      entry={entry}
                      depth={0}
                      selectedPath={selectedPath}
                      onSelectFile={(p) => void openFile(p)}
                      onRefreshParent={() => void refreshTree()}
                    />
                  ))}
                </div>
              </ScrollArea>
              {codingRoot ? (
                <p
                  className="truncate border-t px-2 py-1.5 text-[10px] text-muted-foreground"
                  title={codingRoot}
                >
                  Root: {codingRoot}
                </p>
              ) : null}
            </aside>

            <section className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border bg-card p-3">
              {!selectedPath ? (
                <Empty className="flex-1 border-0">
                  <EmptyHeader>
                    <EmptyTitle>Select a file</EmptyTitle>
                    <EmptyDescription>
                      Open a file from the tree to edit it here. Saves write through
                      the same sandboxed coding root agents use.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs">
                      {selectedPath}
                    </code>
                    {dirty ? <Badge variant="secondary">Unsaved</Badge> : null}
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void save()}
                      disabled={!dirty || fileLoading}
                    >
                      <SaveIcon data-icon="inline-start" />
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openDialog("rename")}
                    >
                      <PencilIcon data-icon="inline-start" />
                      Rename
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => openDialog("delete")}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      Delete
                    </Button>
                  </div>
                  <Textarea
                    className="min-h-[24rem] flex-1 font-mono text-xs"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={fileLoading}
                    spellCheck={false}
                  />
                </>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="terminal" className="mt-0">
          <CodingTerminalPanel />
        </TabsContent>
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "new-file" && "New file"}
              {dialog === "new-folder" && "New folder"}
              {dialog === "rename" && "Rename"}
              {dialog === "delete" && "Delete"}
            </DialogTitle>
          </DialogHeader>
          {dialog === "delete" ? (
            <p className="text-sm text-muted-foreground">
              Delete <code className="text-foreground">{selectedPath}</code>?
              Directories must be empty.
            </p>
          ) : (
            <Input
              value={dialogValue}
              onChange={(e) => setDialogValue(e.target.value)}
              placeholder={
                dialog === "rename" ? "New path" : "Relative path"
              }
              autoFocus
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={dialog === "delete" ? "destructive" : "default"}
              onClick={() => void runDialog()}
            >
              {dialog === "delete" ? "Delete" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
