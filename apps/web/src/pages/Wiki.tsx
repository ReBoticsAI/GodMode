import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
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
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  createWikiPage,
  fetchWikiPages,
  fetchWikiProposals,
  approveWikiProposal,
  rejectWikiProposal,
  type WikiPage as WikiPageType,
  type WikiPageProposal,
  type WikiVisibility,
} from "@/api";
import { WIKI_PATH } from "@/lib/navigation";
import { WikiLayout } from "@/components/wiki/WikiLayout";
import { WikiSearch } from "@/components/wiki/WikiSearch";

export default function Wiki() {
  const [pages, setPages] = useState<WikiPageType[]>([]);
  const [proposals, setProposals] = useState<WikiPageProposal[]>([]);
  const [filter, setFilter] = useState<"all" | WikiVisibility | "proposals">("all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [space, setSpace] = useState("");
  const [visibility, setVisibility] = useState<WikiVisibility>("internal");
  const [body, setBody] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (filter === "proposals") {
        const res = await fetchWikiProposals("pending");
        setProposals(res.proposals);
        setPages([]);
      } else {
        const res = await fetchWikiPages({
          visibility: filter === "all" ? undefined : filter,
          q: debouncedQ.trim() || undefined,
        });
        setPages(res.pages);
        const prop = await fetchWikiProposals("pending").catch(() => ({
          proposals: [] as WikiPageProposal[],
        }));
        setProposals(prop.proposals);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQ]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    try {
      const res = await createWikiPage({
        title: title.trim(),
        bodyMarkdown: body,
        space: space.trim() || null,
        visibility,
      });
      toast.success("Page created");
      setDialogOpen(false);
      setTitle("");
      setSpace("");
      setBody("");
      navigate(`${WIKI_PATH}/${res.page.slug}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [title, body, space, visibility, navigate]);

  return (
    <Page>
      <PageHeader
        title="Wiki"
        description="Internal and published knowledge base."
        actions={<Button onClick={() => setDialogOpen(true)}>New page</Button>}
      />

      <WikiLayout onNewPage={() => setDialogOpen(true)}>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList variant="line">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="internal">Internal</TabsTrigger>
            <TabsTrigger value="external">Published</TabsTrigger>
            <TabsTrigger value="proposals">
              Proposals{proposals.length > 0 ? ` (${proposals.length})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {filter !== "proposals" && (
          <WikiSearch
            className="max-w-xs"
            value={q}
            onChange={setQ}
            placeholder="Search title or content…"
          />
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filter === "proposals" ? (
        proposals.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No pending proposals</CardTitle>
              <CardDescription>
                Wiki synthesize jobs stage create/update patches here for approval.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {proposals.map((p) => (
              <li key={p.id} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{p.action}</Badge>
                  {p.space && (
                    <span className="text-xs uppercase text-muted-foreground">{p.space}</span>
                  )}
                  <span className="font-medium">{p.title}</span>
                </div>
                {p.reason && (
                  <p className="mt-1 text-xs text-muted-foreground">{p.reason}</p>
                )}
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                  {p.body_markdown.slice(0, 400)}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void approveWikiProposal(p.id)
                        .then(() => {
                          toast.success("Proposal approved");
                          return load();
                        })
                        .catch((err) => toast.error((err as Error).message))
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void rejectWikiProposal(p.id)
                        .then(() => {
                          toast.success("Proposal rejected");
                          return load();
                        })
                        .catch((err) => toast.error((err as Error).message))
                    }
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : pages.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No pages</CardTitle>
            <CardDescription>Create the first knowledge base page.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {pages.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => navigate(`${WIKI_PATH}/${p.slug}`)}
                className="flex w-full flex-col gap-1 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent/40"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.title}</span>
                  <Badge
                    variant={p.visibility === "external" ? "default" : "secondary"}
                    className="ml-auto text-[10px]"
                  >
                    {p.visibility === "external" ? "Published" : "Internal"}
                  </Badge>
                </div>
                {p.space && (
                  <span className="text-xs uppercase text-muted-foreground">
                    {p.space}
                  </span>
                )}
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {p.body_markdown.slice(0, 160) || "Empty page"}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      </WikiLayout>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New wiki page</DialogTitle>
            <DialogDescription>
              Internal pages are visible to your workspace; published pages are
              world-readable.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Space (optional)</Label>
                <Input value={space} onChange={(e) => setSpace(e.target.value)} />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Visibility</Label>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as WikiVisibility)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal</SelectItem>
                    <SelectItem value="external">Published (external)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Body (markdown)</Label>
              <Textarea
                rows={8}
                className="font-mono text-xs"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void create()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
