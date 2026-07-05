import { Link } from "react-router-dom";
import type { WikiBacklink } from "@/api";
import { WIKI_PATH } from "@/lib/navigation";

export function WikiBacklinks({ backlinks }: { backlinks: WikiBacklink[] }) {
  if (backlinks.length === 0) return null;

  return (
    <section className="mt-10 border-t pt-6">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Backlinks</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Pages that link here via <code className="text-[11px]">[[wikilinks]]</code> or{" "}
        <code className="text-[11px]">/wiki/…</code> markdown links.
      </p>
      <ul className="flex flex-col gap-1">
        {backlinks.map((p) => (
          <li key={p.id}>
            <Link
              to={`${WIKI_PATH}/${p.slug}`}
              className="text-sm text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
