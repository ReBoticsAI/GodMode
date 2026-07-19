import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  getFeatureDoc,
  preprocessMarketingWikiLinks,
} from "@/lib/feature-docs";
import { safeMarkdownHref } from "@/lib/safe-markdown-href";
import { cn } from "@/lib/utils";
import { MARKETING_BASE } from "./MarketingLayout";

export default function MarketingFeaturePage() {
  const { slug = "" } = useParams();
  const doc = getFeatureDoc(slug);

  const content = useMemo(() => {
    if (!doc) return "";
    let md = doc.bodyMarkdown;
    // PageHeader already shows the title; drop a leading H1 if present.
    md = md.replace(/^#\s+[^\n]+\n+/, "");
    return preprocessMarketingWikiLinks(md);
  }, [doc]);

  if (!doc) {
    return <Navigate to={`${MARKETING_BASE}/features`} replace />;
  }

  return (
    <Page>
      <PageHeader
        title={doc.title}
        description={
          [doc.section, doc.location].filter(Boolean).join(" · ") ||
          doc.summary
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            render={<Link to={`${MARKETING_BASE}/features`} />}
          >
            All features
          </Button>
        }
      />

      {doc.summary ? (
        <p className="max-w-3xl text-sm text-muted-foreground">{doc.summary}</p>
      ) : null}

      <div
        className={cn(
          "prose-money max-w-3xl text-sm leading-relaxed text-foreground",
          "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5",
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold",
          "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold",
          "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
          "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
          "[&_table]:w-full [&_th]:border-b [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
          "[&_td]:border-b [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1"
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a({ href, children, ...props }) {
              const path = href ?? "";
              if (path.startsWith("/") && !path.startsWith("//")) {
                return (
                  <Link to={path} className="text-primary underline underline-offset-2">
                    {children}
                  </Link>
                );
              }
              const safe = safeMarkdownHref(path);
              if (!safe) return <span {...props}>{children}</span>;
              return (
                <a href={safe} target="_blank" rel="noreferrer" {...props}>
                  {children}
                </a>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </Page>
  );
}
