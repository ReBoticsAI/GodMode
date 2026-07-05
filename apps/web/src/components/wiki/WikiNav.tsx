import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PlusIcon } from "lucide-react";
import { fetchWikiPages, type WikiPage as WikiPageType } from "@/api";
import { WIKI_PATH } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WikiSearch } from "@/components/wiki/WikiSearch";

export function WikiNav({
  currentSlug,
  onNewPage,
}: {
  currentSlug?: string;
  onNewPage?: () => void;
}) {
  const [pages, setPages] = useState<WikiPageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const reload = useCallback(() => {
    setLoading(true);
    fetchWikiPages({ q: debouncedQ.trim() || undefined })
      .then((r) => setPages(r.pages))
      .catch(() => setPages([]))
      .finally(() => setLoading(false));
  }, [debouncedQ]);

  useEffect(() => {
    reload();
  }, [reload, currentSlug]);

  const grouped = useMemo(() => {
    const map = new Map<string, WikiPageType[]>();
    for (const p of pages) {
      const key = p.space?.trim() || "General";
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [pages]);

  return (
    <nav
      className="flex w-full shrink-0 flex-col gap-3 md:w-52 lg:w-56"
      aria-label="Wiki pages"
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          to={WIKI_PATH}
          className={cn(
            "text-sm font-semibold transition-colors hover:text-primary",
            !currentSlug ? "text-foreground" : "text-muted-foreground"
          )}
        >
          All pages
        </Link>
        {onNewPage ? (
          <Button variant="ghost" size="icon-sm" onClick={onNewPage} title="New page">
            <PlusIcon className="size-4" />
          </Button>
        ) : null}
      </div>

      <WikiSearch value={q} onChange={setQ} placeholder="Search title or body…" />

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : pages.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {debouncedQ.trim() ? "No matching pages." : "No pages yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {debouncedQ.trim() ? (
            <p className="px-2 text-[10px] text-muted-foreground">
              {pages.length} result{pages.length === 1 ? "" : "s"}
            </p>
          ) : null}
          {grouped.map(([space, items]) => (
            <div key={space}>
              {!debouncedQ.trim() ? (
                <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {space}
                </p>
              ) : null}
              <ul className="flex flex-col gap-0.5">
                {items.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`${WIKI_PATH}/${p.slug}`}
                      className={cn(
                        "block truncate rounded-md px-2 py-1.5 text-sm transition-colors",
                        currentSlug === p.slug
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
