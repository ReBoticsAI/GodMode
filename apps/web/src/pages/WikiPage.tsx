import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";
import { WikiLayout } from "@/components/wiki/WikiLayout";
import { WikiBacklinks } from "@/components/wiki/WikiBacklinks";
import { toast } from "sonner";
import {
  deleteWikiPage,
  fetchWikiPage,
  fetchWikiPages,
  updateWikiPage,
  type WikiBacklink,
  type WikiPage as WikiPageType,
  type WikiVisibility,
} from "@/api";
import { WIKI_PATH } from "@/lib/navigation";

export default function WikiPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState<WikiPageType | null>(null);
  const [backlinks, setBacklinks] = useState<WikiBacklink[]>([]);
  const [wikiPages, setWikiPages] = useState<WikiPageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<WikiVisibility>("internal");

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const [pageRes, indexRes] = await Promise.all([
        fetchWikiPage(slug),
        fetchWikiPages(),
      ]);
      setPage(pageRes.page);
      setBacklinks(pageRes.backlinks);
      setWikiPages(indexRes.pages);
      setTitle(pageRes.page.title);
      setBody(pageRes.page.body_markdown);
      setVisibility(pageRes.page.visibility);
    } catch (err) {
      toast.error((err as Error).message);
      setPage(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!page) return;
    try {
      const res = await updateWikiPage(page.id, {
        title,
        bodyMarkdown: body,
        visibility,
      });
      setPage(res.page);
      setEditing(false);
      if (res.page.slug !== slug) {
        navigate(`${WIKI_PATH}/${res.page.slug}`, { replace: true });
      } else {
        const refreshed = await fetchWikiPage(res.page.slug);
        setBacklinks(refreshed.backlinks);
      }
      toast.success("Saved");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [page, title, body, visibility, slug, navigate]);

  const remove = useCallback(async () => {
    if (!page) return;
    try {
      await deleteWikiPage(page.id);
      toast.success("Deleted");
      navigate(WIKI_PATH);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [page, navigate]);

  if (loading) {
    return (
      <Page>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Page>
    );
  }

  if (!page) {
    return (
      <Page>
        <PageHeader title="Page not found" description="This wiki page is unavailable." />
        <Button variant="outline" onClick={() => navigate(WIKI_PATH)}>
          Back to Wiki
        </Button>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={editing ? "Editing page" : page.title}
        description={page.space ? `Space: ${page.space}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge
              variant={page.visibility === "external" ? "default" : "secondary"}
              className="text-[10px]"
            >
              {page.visibility === "external" ? "Published" : "Internal"}
            </Badge>
            {editing ? (
              <>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void save()}>Save</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="ghost" onClick={() => void remove()}>
                  Delete
                </Button>
              </>
            )}
          </div>
        }
      />

      <nav className="-mt-2 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link to={WIKI_PATH} className="hover:text-foreground">
          Wiki
        </Link>
        {page.space ? (
          <>
            <span>/</span>
            <span>{page.space}</span>
          </>
        ) : null}
        <span>/</span>
        <span className="text-foreground">{page.title}</span>
      </nav>

      <WikiLayout currentSlug={page.slug}>
      {editing ? (
        <div className="grid gap-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select
            value={visibility}
            onValueChange={(v) => setVisibility(v as WikiVisibility)}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="internal">Internal</SelectItem>
              <SelectItem value="external">Published (external)</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            rows={20}
            className="font-mono text-xs"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      ) : (
        <div className="max-w-3xl">
          {page.body_markdown ? (
            <WikiMarkdown
              content={page.body_markdown}
              pages={wikiPages.map((p) => ({ slug: p.slug, title: p.title }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">This page is empty.</p>
          )}
          <WikiBacklinks backlinks={backlinks} />
        </div>
      )}
      </WikiLayout>
    </Page>
  );
}
