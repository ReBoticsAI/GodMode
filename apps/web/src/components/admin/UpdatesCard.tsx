import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  DownloadIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  fetchRecords,
  runRecordActionApi,
  waitForOperationRun,
  type RecordRowClient,
} from "@/lib/object-types-api";
import { randomId } from "@/lib/random-id";

type ReleaseChannel = "stable" | "nightly";

function text(data: Record<string, unknown>, key: string, fallback = "—"): string {
  const value = data[key];
  return typeof value === "string" && value ? value : fallback;
}

function flag(data: Record<string, unknown>, key: string): boolean {
  return data[key] === true || data[key] === 1;
}

function fileSize(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function operationId(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("operationRunId" in result)) {
    return null;
  }
  return String((result as { operationRunId: unknown }).operationRunId);
}

export function UpdatesCard() {
  const [row, setRow] = useState<RecordRowClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchRecords("InstallationUpdateState", { limit: 1 });
      setRow(result.records[0] ?? null);
    } catch {
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const execute = async (
    name: string,
    input: Record<string, unknown> = {},
    confirmed = false
  ) => {
    if (!row || action) return;
    setAction(name);
    setAnnouncement("");
    try {
      const result = await runRecordActionApi(
        "InstallationUpdateState",
        name,
        input,
        {
          id: row.id,
          idempotencyKey: randomId(),
          confirmed,
        }
      );
      const id = operationId(result);
      if (id) {
        const run = await waitForOperationRun(id);
        if (run.status !== "succeeded") {
          throw new Error(run.errorMessage ?? `${name} ${run.status}`);
        }
      }
      const message =
        name === "check_now"
          ? "Update check completed."
          : `Update action ${name.replaceAll("_", " ")} completed.`;
      setAnnouncement(message);
      toast.success(message);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update action failed";
      setAnnouncement(message);
      toast.error(message);
    } finally {
      setAction(null);
    }
  };

  if (loading) {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle>Updates</CardTitle>
          <CardDescription>Loading installation update status…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // The update ObjectType is admin-only. Omitting the card for users who
  // cannot read it avoids exposing inoperative controls.
  if (!row) return null;

  const data = row.data;
  const channel = text(data, "channel", "stable") as ReleaseChannel;
  const status = text(data, "status", "idle");
  const currentVersion = text(data, "current_version");
  const targetVersion = text(
    data,
    "target_version",
    text(data, "available_version")
  );
  const available = flag(data, "update_available") || status === "available";
  const canApply = flag(data, "can_apply");
  const autoCheck = data.auto_check !== false && data.auto_check !== 0;
  const busy =
    action !== null ||
    ["checking", "downloading", "applying", "apply_requested"].includes(status);
  const releaseNotes = text(data, "release_notes", "");
  const compatibility = text(data, "compatibility_status", "unknown");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Updates</CardTitle>
            <CardDescription>
              Signed GodMode releases for this installation.
            </CardDescription>
          </div>
          <Badge variant={available ? "default" : "secondary"}>
            {available ? `${targetVersion} available` : status.replaceAll("_", " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Installed</dt>
            <dd className="font-mono">{currentVersion}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Installation surface</dt>
            <dd>{text(data, "installation_surface", "unknown")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last checked</dt>
            <dd>{text(data, "last_checked_at", "Not checked yet")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Backup</dt>
            <dd>{text(data, "backup_status", "Not required")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Compatibility</dt>
            <dd>{compatibility.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Download size</dt>
            <dd>{fileSize(data.download_size)}</dd>
          </div>
        </dl>

        {releaseNotes && (
          <section aria-labelledby="release-notes-title" className="rounded-lg border p-3">
            <h4 id="release-notes-title" className="text-sm font-medium">
              Release notes
            </h4>
            <p className="mt-1 max-w-[80ch] whitespace-pre-wrap text-sm text-muted-foreground">
              {releaseNotes}
            </p>
          </section>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="release-channel" className="text-sm font-medium">
              Release channel
            </label>
            <Select
              value={channel}
              onValueChange={(value) =>
                void execute("configure", { channel: String(value) }, true)
              }
              disabled={busy}
            >
              <SelectTrigger id="release-channel" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">Stable</SelectItem>
                <SelectItem value="nightly">Nightly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex min-h-8 items-center gap-2 text-sm">
            <Switch
              checked={autoCheck}
              onCheckedChange={(checked) =>
                void execute("configure", { auto_check: checked }, true)
              }
              disabled={busy}
            />
            Check automatically
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void execute("check_now")}
            disabled={busy}
          >
            <RefreshCwIcon className={action === "check_now" ? "animate-spin motion-reduce:animate-none" : ""} />
            Check now
          </Button>
          {available && status !== "downloaded" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void execute("download", {}, true)}
              disabled={busy}
            >
              <DownloadIcon />
              Download
            </Button>
          )}
          {available && canApply && (
            <Button
              type="button"
              onClick={() => void execute("apply", {}, true)}
              disabled={busy}
            >
              <RotateCcwIcon />
              Back up and update
            </Button>
          )}
          {status === "restart_required" && canApply && (
            <Button
              type="button"
              onClick={() => void execute("restart_to_apply", {}, true)}
              disabled={busy}
            >
              <RotateCcwIcon />
              Restart to apply
            </Button>
          )}
          {available && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  void execute("defer", {
                    until: new Date(Date.now() + 86_400_000).toISOString(),
                  }, true)
                }
                disabled={busy}
              >
                Remind me tomorrow
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void execute("skip_release", {}, true)}
                disabled={busy}
              >
                Skip this release
              </Button>
            </>
          )}
        </div>

        {!canApply && available && (
          <p className="max-w-[80ch] text-sm text-muted-foreground">
            {text(
              data,
              "apply_hint",
              "Run the verified host update command shown in the release notes."
            )}
          </p>
        )}
        {status === "idle" && !available && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2Icon className="size-4" aria-hidden="true" />
            This installation is on its selected channel.
          </p>
        )}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </CardContent>
    </Card>
  );
}
