import { useCallback, useEffect, useRef, useState } from "react";
import { DatabaseIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { STATE_TONE } from "@/pages/ai-settings/fields";
import {
  fetchEmbeddingActivity,
  fetchEmbeddingStatus,
  fetchPlatformActions,
  setEmbeddingEnabled,
  type CpuServerStatus,
  type EmbeddingEngineActivity,
  type EmbeddingEngineStatus,
  type PlatformActionLogRow,
} from "@/api";

const POLL_MS = 4000;

const DOT_TONE: Record<string, string> = {
  running: "bg-emerald-500",
  starting: "bg-amber-500",
  stopping: "bg-amber-500",
  error: "bg-red-500",
  stopped: "bg-muted-foreground/50",
};

function uptime(startedAt: string | null): string {
  if (!startedAt) return "—";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function EngineCard({
  title,
  icon,
  blurb,
  server,
}: {
  title: string;
  icon: React.ReactNode;
  blurb: string;
  server: CpuServerStatus | null;
}) {
  const state = server?.state ?? "stopped";
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            {icon}
            {title}
          </CardTitle>
          <Badge
            variant="outline"
            className={cn("gap-1.5 text-[10px]", STATE_TONE[state] ?? STATE_TONE.stopped)}
          >
            <span className={cn("size-1.5 rounded-full", DOT_TONE[state] ?? DOT_TONE.stopped)} />
            {state}
          </Badge>
        </div>
        <CardDescription className="text-[11px]">{blurb}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-muted-foreground">Health</dt>
          <dd className={server?.healthOk ? "text-emerald-500" : "text-muted-foreground"}>
            {server?.healthOk ? "ok" : "—"}
          </dd>
          <dt className="text-muted-foreground">Model</dt>
          <dd className="truncate font-mono" title={server?.modelName ?? undefined}>
            {server?.modelName?.replace(/\.gguf$/i, "") ?? "—"}
          </dd>
          <dt className="text-muted-foreground">Endpoint</dt>
          <dd className="font-mono">
            {server ? `${server.host}:${server.port}` : "—"}
          </dd>
          <dt className="text-muted-foreground">PID</dt>
          <dd className="font-mono">{server?.pid ?? "—"}</dd>
          <dt className="text-muted-foreground">Uptime</dt>
          <dd className="font-mono">{uptime(server?.startedAt ?? null)}</dd>
        </dl>
        {server?.error && (
          <p className="rounded border border-red-500/40 bg-red-500/5 px-2 py-1 text-[10px] text-red-500">
            {server.error}
          </p>
        )}
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Logs ({server?.logs.length ?? 0})
          </p>
          <pre className="max-h-44 overflow-auto rounded-md border bg-black/30 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
            {server?.logs.length ? server.logs.slice(-100).join("\n") : "(no output yet)"}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

export function MemoryEngineTab() {
  const [status, setStatus] = useState<EmbeddingEngineStatus | null>(null);
  const [activity, setActivity] = useState<EmbeddingEngineActivity | null>(null);
  const [platformActions, setPlatformActions] = useState<PlatformActionLogRow[]>([]);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    fetchEmbeddingStatus()
      .then((s) => {
        setStatus(s);
        setAvailable(s.embedder != null || s.enabled);
      })
      .catch(() => undefined);
    fetchEmbeddingActivity()
      .then(setActivity)
      .catch(() => undefined);
    fetchPlatformActions(25)
      .then((r) => setPlatformActions(r.actions))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    // Optimistic: reflect the intended state immediately.
    setStatus((prev) => (prev ? { ...prev, enabled } : prev));
    try {
      const next = await setEmbeddingEnabled(enabled);
      setStatus(next);
    } catch {
      load();
    } finally {
      setBusy(false);
      load();
    }
  };

  const enabled = status?.enabled ?? false;
  const embedderState = status?.embedder?.state ?? "stopped";
  const anyRunning = embedderState === "running";
  const anyStarting = embedderState === "starting";
  const masterLabel = !enabled
    ? "disabled"
    : anyRunning
      ? "running"
      : anyStarting
        ? "starting"
        : "stopped";
  const masterTone = !enabled
    ? STATE_TONE.stopped
    : anyRunning
      ? STATE_TONE.running
      : anyStarting
        ? STATE_TONE.starting
        : STATE_TONE.stopped;

  const cov = activity?.embeddingCoverage;
  const covPct =
    cov && cov.total > 0 ? Math.round((cov.embedded / cov.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Embedding Engine</CardTitle>
            <Badge variant="outline" className={cn("gap-1.5 text-[10px]", masterTone)}>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  !enabled
                    ? "bg-muted-foreground/50"
                    : anyRunning
                      ? "bg-emerald-500"
                      : "bg-amber-500"
                )}
              />
              {masterLabel}
            </Badge>
          </div>
          <CardDescription className="text-[11px]">
            A CPU-pinned <span className="font-medium">embedder</span>{" "}
            (EmbeddingGemma) powers semantic (RAG) recall of your AI's long-term
            memory. Fully optional — chat works with it off and falls back to
            recency. Knowledge maintenance is owned by the Reflection engine.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-xs">
            <span className="text-muted-foreground">Master switch</span>
            <p className="text-[10px] text-muted-foreground">
              {status?.enabledOverride == null
                ? "Using environment default"
                : "Runtime override (persists across restarts)"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">off</span>
            <Switch
              checked={enabled}
              disabled={busy || !available}
              onCheckedChange={(v) => void toggle(v)}
            />
            <span className="text-xs text-muted-foreground">on</span>
          </div>
        </CardContent>
      </Card>

      {!available && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600">
          Embedding engine is not wired into this bridge build. Toggling has no effect.
        </p>
      )}

      <div className="grid gap-4">
        <EngineCard
          title="Embedder"
          icon={<DatabaseIcon className="size-3.5 text-primary" />}
          blurb="EmbeddingGemma — builds vectors so chat can recall relevant memories (RAG)."
          server={status?.embedder ?? null}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Oversight</CardTitle>
          <CardDescription className="text-[11px]">
            What Reflection has queued for your review and how ready RAG is.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["Pending skills", activity?.pending.skills ?? 0],
                ["Pending rules", activity?.pending.rules ?? 0],
                ["Pending memories", activity?.pending.memories ?? 0],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-md border bg-muted/20 px-2 py-2 text-center">
                <div className="text-lg font-semibold tabular-nums">{n}</div>
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Embedding coverage (RAG readiness)</span>
              <span className="font-mono">
                {cov ? `${cov.embedded}/${cov.total} embedded` : "—"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${covPct}%` }}
              />
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-muted-foreground">RAG top-K</dt>
            <dd className="font-mono">{activity?.ragTopK ?? "—"}</dd>
          </dl>

          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Platform Actions</CardTitle>
          <CardDescription className="text-[11px]">
            Recent Platform Builder mutations by agents (structure, pages,
            workflows) for oversight. Denied attempts are recorded too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {platformActions.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">
              No platform actions recorded yet.
            </p>
          ) : (
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">When</th>
                    <th className="px-2 py-1 text-left font-medium">Agent</th>
                    <th className="px-2 py-1 text-left font-medium">Action</th>
                    <th className="px-2 py-1 text-left font-medium">Scope</th>
                    <th className="px-2 py-1 text-left font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {platformActions.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="px-2 py-1 font-mono whitespace-nowrap text-muted-foreground">
                        {a.created_at}
                      </td>
                      <td className="px-2 py-1 font-mono">{a.agent_id}</td>
                      <td className="px-2 py-1 font-mono">{a.action}</td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {a.scope ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1",
                          a.result.startsWith("ok")
                            ? "text-emerald-500"
                            : a.result.startsWith("denied")
                              ? "text-amber-500"
                              : "text-red-500"
                        )}
                      >
                        {a.result}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
