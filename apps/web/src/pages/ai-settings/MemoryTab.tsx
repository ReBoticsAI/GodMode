import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckIcon, ExternalLinkIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { AGENTS_PATH } from "@/lib/navigation";
import { useIntelligence } from "@/lib/intelligence-context";
import {
  approveAiMemory,
  createAiMemory,
  deleteAiMemory,
  fetchAiMemories,
  fetchAiSettings,
  fetchEmbeddingActivity,
  fetchEmbeddingStatus,
  updateAiMemory,
  updateAiSettings,
  type AiMemory,
  type EmbeddingEngineActivity,
  type EmbeddingEngineStatus,
} from "@/api";

type MemoryFilter = "all" | "active" | "pending" | "disabled" | "needs_embedding";

type RetrievalStatus = "pending" | "disabled" | "needs_embedding" | "retrievable";

function getRetrievalStatus(m: AiMemory): RetrievalStatus {
  if (m.status === "pending") return "pending";
  if (m.enabled === 0) return "disabled";
  if (!m.has_embedding) return "needs_embedding";
  return "retrievable";
}

function retrievalLabel(status: RetrievalStatus): string {
  switch (status) {
    case "pending":
      return "Pending approval";
    case "disabled":
      return "Disabled";
    case "needs_embedding":
      return "Needs vector";
    case "retrievable":
      return "Retrievable";
  }
}

function retrievalTone(status: RetrievalStatus): string {
  switch (status) {
    case "pending":
      return "border-amber-500/40 text-amber-600";
    case "disabled":
      return "border-muted-foreground/30 text-muted-foreground";
    case "needs_embedding":
      return "border-sky-500/40 text-sky-600";
    case "retrievable":
      return "border-emerald-500/40 text-emerald-600";
  }
}

function engineLabel(
  enabled: boolean,
  state: string | undefined
): string {
  if (!enabled) return "disabled";
  return state ?? "stopped";
}

function formatValidity(m: AiMemory): string | null {
  if (!m.valid_from && !m.valid_until) return null;
  if (m.valid_from && m.valid_until) return `${m.valid_from} → ${m.valid_until}`;
  if (m.valid_from) return `from ${m.valid_from}`;
  return `until ${m.valid_until}`;
}

function MemoryMetaBadges({ memory }: { memory: AiMemory }) {
  const retrieval = getRetrievalStatus(memory);
  const validity = formatValidity(memory);

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <Badge variant="outline" className={cn("text-[10px]", retrievalTone(retrieval))}>
        {retrievalLabel(retrieval)}
      </Badge>
      <Badge variant="secondary" className="text-[10px]">
        {memory.scope}
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        {memory.source}
      </Badge>
      {memory.category && (
        <Badge variant="outline" className="text-[10px]">
          {memory.category}
        </Badge>
      )}
      {memory.has_embedding ? (
        <Badge variant="outline" className="text-[10px] text-emerald-600">
          Vector ready
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Vector missing
        </Badge>
      )}
      {validity && (
        <Badge variant="outline" className="text-[10px]">
          {validity}
        </Badge>
      )}
    </div>
  );
}

export function MemoryTab() {
  const { activeAgentId, setAgentsSection } = useIntelligence();
  const navigate = useNavigate();
  const [memories, setMemories] = useState<AiMemory[]>([]);
  const [newText, setNewText] = useState("");
  const [memoryMode, setMemoryMode] = useState<"approval" | "auto">("approval");
  const [engineStatus, setEngineStatus] = useState<EmbeddingEngineStatus | null>(null);
  const [engineActivity, setEngineActivity] = useState<EmbeddingEngineActivity | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MemoryFilter>("all");

  const load = useCallback(() => {
    fetchAiMemories(undefined, activeAgentId)
      .then(setMemories)
      .catch(() => setMemories([]));
  }, [activeAgentId]);

  const loadEngine = useCallback(() => {
    fetchEmbeddingStatus()
      .then(setEngineStatus)
      .catch(() => setEngineStatus(null));
    fetchEmbeddingActivity()
      .then(setEngineActivity)
      .catch(() => setEngineActivity(null));
  }, []);

  useEffect(() => {
    load();
    loadEngine();
  }, [load, loadEngine]);

  useEffect(() => {
    fetchAiSettings()
      .then((s) => setMemoryMode(s.memoryMode))
      .catch(() => undefined);
  }, []);

  const add = async () => {
    const text = newText.trim();
    if (!text) return;
    await createAiMemory({ text, scope: "global", agentId: activeAgentId });
    setNewText("");
    load();
    loadEngine();
  };

  const toggleMode = async (auto: boolean) => {
    const next = auto ? "auto" : "approval";
    setMemoryMode(next);
    await updateAiSettings({ memoryMode: next }).catch(() => undefined);
  };

  const openEngine = () => {
    setAgentsSection("activity");
    navigate(`${AGENTS_PATH}?section=activity`);
  };

  const filteredMemories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return memories.filter((m) => {
      const retrieval = getRetrievalStatus(m);
      if (filter === "active" && (m.status !== "active" || m.enabled === 0)) return false;
      if (filter === "pending" && m.status !== "pending") return false;
      if (filter === "disabled" && m.enabled !== 0) return false;
      if (filter === "needs_embedding" && retrieval !== "needs_embedding") return false;
      if (!q) return true;
      return (
        m.text.toLowerCase().includes(q) ||
        (m.category ?? "").toLowerCase().includes(q) ||
        m.source.toLowerCase().includes(q)
      );
    });
  }, [memories, search, filter]);

  const pending = filteredMemories.filter((m) => m.status === "pending");
  const active = filteredMemories.filter((m) => m.status !== "pending");

  const engineEnabled = engineStatus?.enabled ?? false;
  const embedderState = engineStatus?.embedder?.state ?? "stopped";
  const cov = engineActivity?.embeddingCoverage;
  const covPct = cov && cov.total > 0 ? Math.round((cov.embedded / cov.total) * 100) : 0;

  const filterButtons: Array<{ id: MemoryFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "pending", label: "Pending" },
    { id: "disabled", label: "Disabled" },
    { id: "needs_embedding", label: "Needs vector" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Automated memory system</CardTitle>
              <CardDescription className="text-[11px]">
                The Reflection engine drafts memory candidates from chats and platform
                activity. Approved memories are stored in the database and recalled via
                hybrid RAG (BM25 + vectors), not injected wholesale into every prompt.
              </CardDescription>
            </div>
            <Button type="button" size="sm" variant="outline" className="shrink-0 text-xs" onClick={openEngine}>
              <ExternalLinkIcon data-icon="inline-start" className="size-3" />
              Embedding engine
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border bg-muted/20 px-2 py-2 text-center">
              <div className="text-[10px] text-muted-foreground">Embedder</div>
              <div className="text-xs font-medium">{engineLabel(engineEnabled, embedderState)}</div>
            </div>
            <div className="rounded-md border bg-muted/20 px-2 py-2 text-center">
              <div className="text-[10px] text-muted-foreground">Pending</div>
              <div className="text-xs font-medium tabular-nums">
                {engineActivity?.pending.memories ?? pending.length}
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 px-2 py-2 text-center">
              <div className="text-[10px] text-muted-foreground">RAG top-K</div>
              <div className="text-xs font-medium tabular-nums">
                {engineActivity?.ragTopK ?? "—"}
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Embedding coverage (vector readiness)</span>
              <span className="font-mono">
                {cov ? `${cov.embedded}/${cov.total} (${covPct}%)` : "—"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${covPct}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automated memory capture</CardTitle>
          <CardDescription>
            After chats, Reflection can propose durable facts. In approval mode new
            candidates wait for review; in auto mode they are saved active immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="text-sm">
            Mode: <span className="font-medium">{memoryMode}</span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">approval</span>
            <Switch
              checked={memoryMode === "auto"}
              onCheckedChange={(v) => void toggleMode(v)}
            />
            <span className="text-xs text-muted-foreground">auto</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Browse memories</CardTitle>
          <CardDescription className="text-[11px]">
            Active memories are retrieved when relevant to the current chat. Vector
            missing means BM25 may still match, but semantic recall is weaker until the
            embedder runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search memory text, category, source…"
                className="pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {filterButtons.map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={filter === id ? "default" : "outline"}
                  className="text-xs"
                  onClick={() => setFilter(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending memories ({pending.length})</CardTitle>
            <CardDescription>
              Proposed by Reflection. Approve to make them eligible for hybrid RAG recall,
              or reject to discard.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pending.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{m.text}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {m.updated_at} · reflection candidate
                  </p>
                  <MemoryMetaBadges memory={m} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void approveAiMemory(m.id).then(() => { load(); loadEngine(); })}
                >
                  <CheckIcon className="text-emerald-500" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void deleteAiMemory(m.id).then(() => { load(); loadEngine(); })}
                >
                  <XIcon className="text-destructive" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active memories</CardTitle>
          <CardDescription>
            DB-backed facts for this agent. Hybrid RAG selects the most relevant entries
            per turn; disable a memory to exclude it from recall.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="e.g. I prefer concise bullet summaries"
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
            <Button type="button" onClick={() => void add()}>
              <PlusIcon />
              Add
            </Button>
          </div>
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {memories.length === 0 ? "No memories yet." : "No memories match the current filter."}
            </p>
          )}
          {active.map((m) => (
            <div
              key={m.id}
              className="flex items-start gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{m.text}</p>
                <p className="text-[10px] text-muted-foreground">
                  {m.updated_at}
                  {m.embedding_model ? ` · ${m.embedding_model}` : ""}
                  {m.embedding_dim ? ` (${m.embedding_dim}d)` : ""}
                </p>
                <MemoryMetaBadges memory={m} />
              </div>
              <Switch
                checked={m.enabled === 1}
                onCheckedChange={(v) => {
                  void updateAiMemory(m.id, { enabled: v }).then(load);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => void deleteAiMemory(m.id).then(() => { load(); loadEngine(); })}
              >
                <Trash2Icon className="text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
