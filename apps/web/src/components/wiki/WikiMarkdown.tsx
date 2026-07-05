import { useMemo } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { preprocessWikiLinks, type WikiLinkPage } from "@/lib/wiki-links";
import { WIKI_PATH } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { safeMarkdownHref } from "@/lib/safe-markdown-href";

/** Markdown for wiki pages — wikilinks, internal /wiki/… links stay in-app. */
export function WikiMarkdown({
  content,
  pages = [],
}: {
  content: string;
  pages?: WikiLinkPage[];
}) {
  const rendered = useMemo(
    () => preprocessWikiLinks(content, pages),
    [content, pages]
  );

  return (
    <div
      className={cn(
        "prose-money max-w-none text-sm leading-relaxed text-foreground",
        "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold",
        "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground"
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...props }) {
            const path = href ?? "";
            if (path.startsWith("wiki:missing:")) {
              const title = decodeURIComponent(path.slice("wiki:missing:".length));
              return (
                <span
                  className="border-b border-dashed border-muted-foreground/60 text-muted-foreground"
                  title={`No page yet: ${title}`}
                >
                  {children}
                </span>
              );
            }
            if (path.startsWith(WIKI_PATH) || path.startsWith("/wiki/")) {
              return (
                <Link to={path} className="text-primary underline underline-offset-2">
                  {children}
                </Link>
              );
            }
            if (path.startsWith("/") && !path.startsWith("//")) {
              return (
                <Link to={path} className="text-primary underline underline-offset-2">
                  {children}
                </Link>
              );
            }
            const safeHref = safeMarkdownHref(href ?? undefined);
            if (!safeHref) {
              return <span {...props}>{children}</span>;
            }
            return (
              <a
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {rendered}
      </ReactMarkdown>
    </div>
  );
}
