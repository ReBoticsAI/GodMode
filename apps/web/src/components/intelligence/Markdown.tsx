import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import { useIntelligence } from "@/lib/intelligence-context";
import { parseArtifactViewerHref } from "./ArtifactViewerDialog";
import { safeMarkdownHref } from "@/lib/safe-markdown-href";

function MarkdownCore({
  content,
  onArtifactLink,
}: {
  content: string;
  onArtifactLink?: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "prose-money max-w-none text-sm leading-relaxed text-foreground",
        "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold",
        "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1"
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...props }) {
            if (onArtifactLink) {
              const artifactId = parseArtifactViewerHref(href ?? undefined);
              if (artifactId) {
                return (
                  <button
                    type="button"
                    className="text-primary underline underline-offset-2 hover:text-primary/80"
                    onClick={() => onArtifactLink(artifactId)}
                  >
                    {children}
                  </button>
                );
              }
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
          code({ inline, className, children, ...props }: {
            inline?: boolean;
            className?: string;
            children?: React.ReactNode;
          }) {
            const match = /language-(\w+)/.exec(className ?? "");
            if (!inline && match) {
              return (
                <SyntaxHighlighter
                  style={oneDark as Record<string, React.CSSProperties>}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: "0.5rem 0",
                    borderRadius: "0.5rem",
                    fontSize: "0.8rem",
                    background: "rgba(0,0,0,0.4)",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            }
            return (
              <code
                className={cn(
                  "rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground",
                  className
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownWithArtifactLinks({ content }: { content: string }) {
  const { openArtifactViewer } = useIntelligence();
  return (
    <MarkdownCore
      content={content}
      onArtifactLink={(id) => openArtifactViewer({ id })}
    />
  );
}

/**
 * Renders assistant markdown the way Cursor's chat does: GFM lists/tables,
 * inline code chips, and fenced code blocks with syntax highlighting.
 */
function MarkdownImpl({
  content,
  artifactLinks = false,
}: {
  content: string;
  /** When true, `godmode:artifact:<id>` links open the artifact viewer. */
  artifactLinks?: boolean;
}) {
  if (artifactLinks) return <MarkdownWithArtifactLinks content={content} />;
  return <MarkdownCore content={content} />;
}

export const Markdown = memo(MarkdownImpl);
