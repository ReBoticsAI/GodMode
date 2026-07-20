import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  getFeatureDoc,
  preprocessMarketingWikiLinks,
} from "@/lib/feature-docs";
import { safeMarkdownHref } from "@/lib/safe-markdown-href";
import { cn } from "@/lib/utils";
import { MARKETING_BASE } from "./MarketingLayout";

type LightboxImage = { src: string; alt: string };

export default function MarketingFeaturePage() {
  const { slug = "" } = useParams();
  const doc = getFeatureDoc(slug);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

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
        <p className="max-w-5xl text-base text-muted-foreground leading-relaxed">
          {doc.summary}
        </p>
      ) : null}

      <div
        className={cn(
          "prose-money w-full text-base leading-relaxed text-foreground",
          "[&_p]:my-3 [&_ul]:my-3 [&_ul]:max-w-5xl [&_ol]:my-3 [&_ol]:max-w-5xl [&_li]:my-1",
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6",
          "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:max-w-5xl [&_h1]:text-2xl [&_h1]:font-semibold",
          "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:max-w-5xl [&_h2]:text-xl [&_h2]:font-semibold",
          "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:max-w-5xl [&_h3]:text-lg [&_h3]:font-semibold",
          "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
          "[&_table]:max-w-5xl [&_table]:w-full [&_th]:border-b [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left",
          "[&_td]:border-b [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1.5"
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p({ node, children }) {
              const kids = node?.children ?? [];
              if (
                kids.length === 1 &&
                kids[0]?.type === "element" &&
                kids[0].tagName === "img"
              ) {
                return <div className="my-5 w-full max-w-none">{children}</div>;
              }
              return <p className="my-3 max-w-5xl">{children}</p>;
            },
            img({ src, alt }) {
              if (!src || typeof src !== "string") return null;
              if (!(src.startsWith("/features/") || src.startsWith("/assets/"))) {
                return null;
              }
              const label = alt?.trim() || "Feature screenshot";
              return (
                <button
                  type="button"
                  onClick={() => setLightbox({ src, alt: label })}
                  aria-label={`Expand ${label}`}
                  className="group block w-full cursor-zoom-in rounded-md border border-border text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <img
                    src={src}
                    alt={label}
                    loading="lazy"
                    decoding="async"
                    className="block w-full max-w-full rounded-[calc(var(--radius-md)-1px)]"
                  />
                </button>
              );
            },
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

      <Dialog
        open={lightbox !== null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      >
        <DialogPortal>
          <DialogOverlay className="bg-black/80 supports-backdrop-filter:backdrop-blur-sm" />
          <DialogPrimitive.Popup
            className={cn(
              "fixed top-1/2 left-1/2 z-50 flex h-[min(96vh,100%)] w-[min(96vw,100%)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-lg bg-background p-2 outline-none ring-1 ring-border",
              "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            )}
            aria-describedby={undefined}
          >
            <DialogTitle className="sr-only">
              {lightbox?.alt ?? "Feature screenshot"}
            </DialogTitle>
            <DialogClose
              render={
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute top-3 right-3 z-10"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogClose>
            {lightbox ? (
              <img
                src={lightbox.src}
                alt={lightbox.alt}
                className="mx-auto my-auto max-h-full max-w-full object-contain"
              />
            ) : null}
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
    </Page>
  );
}
