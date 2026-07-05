import { useRef, useEffect, useState } from "react";
import {
  CpuIcon,
  ImageIcon,
  PlayIcon,
  RotateCwIcon,
  Share2Icon,
  SquareIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  shareModel,
  type AiModel,
  type AiSettings as AiSettingsType,
  type AiStatus,
} from "@/api";
import { formatBytes, NumberField, SegmentedField, ToggleField } from "./fields";

/** Owner affordance: share a single local model with a friend for free inference. */
function ShareModelButton({ model }: { model: AiModel }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const friendlyName = model.name.replace(/\.gguf$/i, "");

  const submit = async () => {
    if (!email.trim()) {
      toast.error("Enter a friend's email");
      return;
    }
    setBusy(true);
    try {
      await shareModel({ modelPath: model.path, granteeEmail: email.trim(), name: friendlyName });
      toast.success(`Shared "${friendlyName}" with ${email.trim()}`);
      setEmail("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to share model");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title="Share for free with a friend"
        className="inline-flex size-6 items-center justify-center rounded hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            setOpen(true);
          }
        }}
      >
        <Share2Icon className="size-3.5 text-muted-foreground" />
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share model</DialogTitle>
            <DialogDescription>
              Give a friend free inference access to{" "}
              <span className="font-medium">{friendlyName}</span>. No credits are
              charged — they can point an agent at it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Friend&apos;s email</Label>
            <Input
              autoFocus
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? <Spinner className="size-4" /> : <Share2Icon className="size-4" />}
              Share
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ModelTab({
  models,
  settings,
  status,
  selectedModel,
  setSelectedModel,
  busy,
  onStart,
  onStop,
  onRestart,
  saveSetting,
  launchLine,
}: {
  models: AiModel[];
  settings: AiSettingsType | null;
  status: AiStatus | null;
  selectedModel: string;
  setSelectedModel: (p: string) => void;
  busy: string | null;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  saveSetting: (patch: Partial<AiSettingsType>) => void;
  launchLine: string | null;
}) {
  const logRef = useRef<HTMLPreElement>(null);
  const state = status?.state ?? "stopped";
  const running = state === "running";
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [status?.logs]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>
            Scanned from{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {settings?.modelDirs ?? "…"}
            </code>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {models.map((m) => (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedModel(m.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelectedModel(m.path);
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                selectedModel === m.path
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/60 hover:bg-muted/50"
              )}
            >
              <CpuIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">
                  {m.name.replace(/\.gguf$/i, "")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(m.sizeBytes)}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {m.isMultimodal && (
                  <Badge variant="secondary" className="gap-1">
                    <ImageIcon className="size-3" />
                    vision
                  </Badge>
                )}
                {status?.modelPath === m.path && running && (
                  <Badge className="bg-emerald-500/15 text-emerald-500">loaded</Badge>
                )}
                {!m.isMmproj && <ShareModelButton model={m} />}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button onClick={onStart} disabled={busy !== null || running}>
              {busy === "start" ? <Spinner className="size-4" /> : <PlayIcon />}
              Start
            </Button>
            <Button variant="outline" onClick={onStop} disabled={busy !== null || state === "stopped"}>
              <SquareIcon />
              Stop
            </Button>
            <Button variant="outline" onClick={onRestart} disabled={busy !== null || !selectedModel}>
              <RotateCwIcon />
              Restart
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server flags</CardTitle>
          <CardDescription>Apply on next Start / Restart.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumberField id="gpuLayers" label="GPU layers" value={settings?.gpuLayers ?? 99} onCommit={(n) => saveSetting({ gpuLayers: n })} />
            <div className="flex flex-col gap-1">
              <NumberField id="ctxSize" label="Context size" value={settings?.ctxSize ?? 65536} step={1024} onCommit={(n) => saveSetting({ ctxSize: n })} />
              <div className="flex flex-wrap gap-1">
                {([32768, 65536, 131072] as const).map((n) => (
                  <Button key={n} size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => saveSetting({ ctxSize: n })}>
                    {n === 131072 ? "131k (full)" : `${n / 1024}k`}
                  </Button>
                ))}
              </div>
            </div>
            <NumberField id="port" label="Port" value={settings?.port ?? 8080} onCommit={(n) => saveSetting({ port: n })} />
            <NumberField id="threads" label="Threads" value={settings?.threads ?? 0} min={0} onCommit={(n) => saveSetting({ threads: n })} />
            <NumberField id="batchSize" label="Batch size" value={settings?.batchSize ?? 2048} step={256} onCommit={(n) => saveSetting({ batchSize: n })} />
            <NumberField id="ubatchSize" label="Micro-batch" value={settings?.ubatchSize ?? 512} step={128} onCommit={(n) => saveSetting({ ubatchSize: n })} />
            <NumberField id="parallel" label="Parallel" value={settings?.parallel ?? 1} min={1} onCommit={(n) => saveSetting({ parallel: n })} />
            <SegmentedField label="Flash attention" value={(settings?.flashAttn ?? "on") as "on" | "off" | "auto"} options={["on", "off", "auto"] as const} onChange={(v) => saveSetting({ flashAttn: v })} />
          </div>
          <ToggleField label="Jinja template" checked={settings?.jinja ?? true} onChange={(v) => saveSetting({ jinja: v })} />
          <ToggleField label="Auto-start on boot" checked={settings?.autoStart ?? false} onChange={(v) => saveSetting({ autoStart: v })} />
          {launchLine && (
            <pre className="overflow-x-auto rounded-lg border bg-black/40 p-3 font-mono text-xs text-muted-foreground">
              {launchLine}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
          <CardDescription>
            {status?.pid ? `PID ${status.pid}` : "Not running"}
            {status?.tokensPerSecond != null && ` · ${status.tokensPerSecond.toFixed(1)} t/s`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status?.error && (
            <p className="mb-2 text-sm text-red-500">{status.error}</p>
          )}
          <pre ref={logRef} className="h-48 overflow-auto rounded-lg border bg-black/40 p-3 font-mono text-xs text-muted-foreground">
            {status?.logs?.join("\n") ?? "No logs yet."}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
