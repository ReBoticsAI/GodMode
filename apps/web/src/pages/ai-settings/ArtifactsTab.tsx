import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLinkIcon, FileTextIcon, MessageCircleIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useIntelligence } from "@/lib/intelligence-context";
import {
  deleteAiArtifact,
  fetchAiArtifacts,
  type AiArtifact,
} from "@/api";
import { KnowledgeSearchFilterBar } from "./knowledge-badges";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ArtifactMetaBadges({ artifact }: { artifact: AiArtifact }) {
  const stored = artifact.has_content === 1;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <Badge
        variant="outline"
        className={
          stored
            ? "border-emerald-500/40 text-[10px] text-emerald-600"
            : "text-[10px] text-muted-foreground"
        }
      >
        {stored ? "Stored" : "File-only"}
      </Badge>
      <Badge variant="secondary" className="text-[10px]">
        {artifact.kind}
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        {formatBytes(artifact.size_bytes)}
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        {artifact.source}
      </Badge>
    </div>
  );
}

export function ArtifactsTab() {
  const { activeAgentId, openArtifactViewer, artifactViewer, discussArtifactInChat } =
    useIntelligence();
  const [artifacts, setArtifacts] = useState<AiArtifact[]>([]);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");

  const load = useCallback(() => {
    fetchAiArtifacts(activeAgentId)
      .then((r) => setArtifacts(r.artifacts))
      .catch(() => setArtifacts([]));
  }, [activeAgentId]);

  useEffect(() => {
    load();
  }, [load]);

  const kinds = useMemo(() => {
    const set = new Set(artifacts.map((a) => a.kind).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [artifacts]);

  const summary = useMemo(() => {
    const stored = artifacts.filter((a) => a.has_content === 1).length;
    const fileOnly = artifacts.length - stored;
    return { total: artifacts.length, stored, fileOnly };
  }, [artifacts]);

  const filteredArtifacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return artifacts.filter((a) => {
      if (kindFilter !== "all" && a.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q) ||
        a.kind.toLowerCase().includes(q) ||
        a.source.toLowerCase().includes(q)
      );
    });
  }, [artifacts, search, kindFilter]);

  const view = (a: AiArtifact) => {
    openArtifactViewer({ id: a.id, name: a.name });
  };

  const remove = (a: AiArtifact) => {
    void deleteAiArtifact(a.id, activeAgentId).then(() => {
      load();
    });
  };

  const kindFilters = kinds.map((k) => ({
    id: k,
    label: k === "all" ? "All kinds" : k,
  }));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Artifacts overview</CardTitle>
          <CardDescription className="text-[11px]">
            DB-backed files for this agent. Content lives in SQLite; the on-disk path is a cache or
            export location, not the source of truth.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-[11px] text-muted-foreground">
            {summary.total} total · {summary.stored} stored in DB · {summary.fileOnly} file-only
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Artifacts</CardTitle>
              <CardDescription>
                Per-agent sandbox outputs from chats, tools, and workflows. Click to open the
                formatted viewer.
              </CardDescription>
            </div>
            <Button type="button" variant="ghost" size="icon-xs" onClick={load}>
              <RotateCwIcon />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <KnowledgeSearchFilterBar
            search={search}
            onSearchChange={setSearch}
            filter={kindFilter}
            onFilterChange={setKindFilter}
            filters={kindFilters}
            placeholder="Search name, description, kind…"
          />

          {filteredArtifacts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {artifacts.length === 0 ? "No artifacts yet." : "No artifacts match the current filter."}
            </p>
          )}

          {filteredArtifacts.map((a) => {
            const isOpen = artifactViewer?.id === a.id;
            return (
              <div
                key={a.id}
                className={
                  isOpen
                    ? "rounded-lg border border-primary/40 bg-primary/5 px-3 py-2"
                    : "rounded-lg border px-3 py-2"
                }
              >
                <div className="flex items-start gap-2">
                  <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => view(a)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    {a.description && (
                      <p className="truncate text-xs text-muted-foreground">{a.description}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground">updated {a.updated_at}</p>
                    <ArtifactMetaBadges artifact={a} />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Discuss in chat"
                    onClick={() =>
                      discussArtifactInChat({
                        id: a.id,
                        name: a.name,
                        agentId: a.agent_id,
                      })
                    }
                  >
                    <MessageCircleIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Open viewer"
                    onClick={() => view(a)}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => remove(a)}
                  >
                    <Trash2Icon className="text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
