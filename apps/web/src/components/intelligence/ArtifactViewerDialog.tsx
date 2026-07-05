import { useCallback, useEffect, useState } from "react";
import { FileTextIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useIntelligence } from "@/lib/intelligence-context";
import { fetchAiArtifact, type AiArtifact } from "@/api";
import { Markdown } from "./Markdown";

const ARTIFACT_LINK_PREFIX = "godmode:artifact:";

export function artifactViewerHref(id: string): string {
  return `${ARTIFACT_LINK_PREFIX}${id}`;
}

export function parseArtifactViewerHref(href: string | undefined): string | null {
  if (!href?.startsWith(ARTIFACT_LINK_PREFIX)) return null;
  const id = href.slice(ARTIFACT_LINK_PREFIX.length).trim();
  return id || null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isMarkdownArtifact(artifact: AiArtifact | null, content: string | null): boolean {
  if (!content) return false;
  const kind = artifact?.kind?.toLowerCase() ?? "";
  const mime = artifact?.mime_type?.toLowerCase() ?? "";
  const name = artifact?.name?.toLowerCase() ?? "";
  if (kind === "markdown" || kind === "md") return true;
  if (mime.includes("markdown") || mime === "text/markdown") return true;
  if (name.endsWith(".md") || name.endsWith(".markdown")) return true;
  return content.trimStart().startsWith("#") || content.includes("\n## ");
}

/** Full-screen markdown (or plain text) viewer for agent artifacts. */
export function ArtifactViewerDialog() {
  const { artifactViewer, closeArtifactViewer, activeAgentId } = useIntelligence();
  const open = artifactViewer != null;
  const [artifact, setArtifact] = useState<AiArtifact | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!artifactViewer) return;
    setLoading(true);
    setError(null);
    setArtifact(null);
    setContent(null);
    fetchAiArtifact(artifactViewer.id, activeAgentId, true)
      .then((r) => {
        setArtifact(r);
        setContent(r.content ?? "");
      })
      .catch((err) => {
        setError((err as Error).message || "Failed to load artifact");
      })
      .finally(() => setLoading(false));
  }, [artifactViewer, activeAgentId]);

  useEffect(() => {
    if (open) load();
    else {
      setArtifact(null);
      setContent(null);
      setError(null);
    }
  }, [open, load]);

  const title = artifact?.name ?? artifactViewer?.name ?? "Artifact";
  const renderMarkdown = isMarkdownArtifact(artifact, content);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeArtifactViewer();
      }}
    >
      <DialogContent className="flex max-h-[min(88vh,900px)] w-[min(96vw,56rem)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
          <div className="flex items-start gap-2">
            <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">{title}</DialogTitle>
              {artifact?.description && (
                <DialogDescription className="mt-0.5 line-clamp-2 text-xs">
                  {artifact.description}
                </DialogDescription>
              )}
              {artifact && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Badge variant="secondary" className="text-[10px]">
                    {artifact.kind}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {formatBytes(artifact.size_bytes)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    updated {artifact.updated_at}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 py-3">
            {loading && (
              <p className="text-sm text-muted-foreground">Loading artifact…</p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {!loading && !error && content != null && (
              renderMarkdown ? (
                <Markdown content={content} artifactLinks />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
                  {content || "(empty)"}
                </pre>
              )
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
