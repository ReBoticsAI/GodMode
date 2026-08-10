import { useCallback, useEffect, useState } from "react";
import {
  downloadAdminPlatformBackup,
  fetchAdminBackupStamps,
  fetchAdminBackupStatus,
  fetchAdminObservabilityRequests,
  triggerAdminPlatformBackup,
  type AdminBackupStamp,
  type AdminRequestLogRow,
} from "@/api";
import {
  Card,
  CardAction,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
type LevelFilter = "all" | "warn" | "error";
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
export function AdminObservabilityPanel() {
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [requests, setRequests] = useState<AdminRequestLogRow[]>([]);
  const [stamps, setStamps] = useState<AdminBackupStamp[]>([]);
  const [selectedStamp, setSelectedStamp] = useState<string>("latest");
  const [backup, setBackup] = useState<{
    status: string;
    localPath: string | null;
    remoteUri: string | null;
    error: string | null;
    updatedAt: string;
  } | null>(null);
  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchAdminObservabilityRequests({ limit: 200, level }),
      fetchAdminBackupStatus(),
      fetchAdminBackupStamps(30),
    ])
      .then(([obs, backupRes, stampsRes]) => {
        setRequests(obs.requests);
        setBackup(backupRes.backup);
        setStamps(stampsRes.stamps);
        setSelectedStamp((prev) => {
          if (prev === "latest") return prev;
          if (stampsRes.stamps.some((s) => s.stamp === prev)) return prev;
          return "latest";
        });
      })
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load observability"
        )
      )
      .finally(() => setLoading(false));
  }, [level]);
  useEffect(() => {
    reload();
  }, [reload]);
  const runBackup = async () => {
    setBackingUp(true);
    try {
      const res = await triggerAdminPlatformBackup();
      setBackup(res.backup);
      toast.success("Local snapshot complete");
      const stampsRes = await fetchAdminBackupStamps(30);
      setStamps(stampsRes.stamps);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backup failed");
      await reload();
    } finally {
      setBackingUp(false);
    }
  };
  const runDownload = async (stamp?: string) => {
    setDownloading(true);
    try {
      await downloadAdminPlatformBackup(
        stamp && stamp !== "latest" ? stamp : undefined
      );
      toast.success("Backup download started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };
  const runSnapshotThenDownload = async () => {
    setBackingUp(true);
    setDownloading(true);
    try {
      const res = await triggerAdminPlatformBackup();
      setBackup(res.backup);
      const stampsRes = await fetchAdminBackupStamps(30);
      setStamps(stampsRes.stamps);
      const stampFromPath = res.backup.localPath
        ? res.backup.localPath.replace(/\\/g, "/").split("/").pop()
        : stampsRes.stamps[0]?.stamp;
      await downloadAdminPlatformBackup(stampFromPath);
      toast.success("Snapshot complete; download started");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Snapshot or download failed"
      );
      await reload();
    } finally {
      setBackingUp(false);
      setDownloading(false);
    }
  };
  const busy = backingUp || downloading;
  const hasStamps = stamps.length > 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Backup status</CardTitle>
          <CardDescription>
            Latest entry from <code>platform_backup_meta</code>. Cron and this
            one-click local snapshot write here. Soft retention for request logs
            keeps the newest ~5k warn/error rows in Cloud.sqlite. Optional S3
            upload stays on the operator cron script. Download streams a closed
            stamp (SQLite + DuckDB timeseries) as tar.gz for offsite PC copy;
            platform admin only.
          </CardDescription>
          <CardAction>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void runBackup()}
              >
                {backingUp && !downloading
                  ? "Snapshotting..."
                  : "Run local snapshot"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !hasStamps}
                onClick={() =>
                  void runDownload(
                    selectedStamp === "latest" ? undefined : selectedStamp
                  )
                }
              >
                {downloading && !backingUp
                  ? "Downloading..."
                  : selectedStamp === "latest"
                    ? "Download latest backup"
                    : "Download selected backup"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runSnapshotThenDownload()}
              >
                {busy && backingUp && downloading
                  ? "Working..."
                  : "Snapshot then download"}
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading && !backup ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : backup ? (
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-border p-3">
                <p className="text-muted-foreground">Status</p>
                <p className="font-medium capitalize">{backup.status}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-muted-foreground">Updated</p>
                <p className="font-medium text-xs">{backup.updatedAt}</p>
              </div>
              <div className="rounded-md border border-border p-3 sm:col-span-2">
                <p className="text-muted-foreground">Local path</p>
                <p className="truncate font-mono text-xs">
                  {backup.localPath ?? "n/a"}
                </p>
              </div>
              {backup.remoteUri ? (
                <div className="rounded-md border border-border p-3 sm:col-span-2">
                  <p className="text-muted-foreground">Remote</p>
                  <p className="truncate font-mono text-xs">{backup.remoteUri}</p>
                </div>
              ) : null}
              {backup.error ? (
                <div className="rounded-md border border-destructive/40 p-3 sm:col-span-2">
                  <p className="text-muted-foreground">Error</p>
                  <p className="text-destructive text-xs">{backup.error}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No backup recorded yet. Run{" "}
              <code>scripts/backup/snapshot-platform.mjs</code> or wait for the
              scheduled host cron.
            </p>
          )}
          {hasStamps ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="text-muted-foreground text-sm shrink-0">
                Download stamp
              </p>
              <Select
                value={selectedStamp}
                onValueChange={(v) => setSelectedStamp(v ?? "latest")}
              >
                <SelectTrigger className="w-full sm:max-w-md">
                  <SelectValue placeholder="Latest" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">
                    Latest ({stamps[0]?.stamp})
                  </SelectItem>
                  {stamps.map((s) => (
                    <SelectItem key={s.stamp} value={s.stamp}>
                      {s.stamp}
                      {s.bytes > 0 ? ` Â· ${formatBytes(s.bytes)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Request errors</CardTitle>
            <CardDescription>
              Warn and error HTTP rows from Bridge (
              <code>platform_request_log</code>). Info lines stay on Docker
              stdout only.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={level}
              onValueChange={(v) => setLevel(v as LevelFilter)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead className="text-right">ms</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      No warn/error requests logged yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.createdAt}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.level === "error" ? "destructive" : "secondary"
                          }
                        >
                          {r.level}
                        </Badge>
                      </TableCell>
                      <TableCell>{r.status}</TableCell>
                      <TableCell>{r.method}</TableCell>
                      <TableCell className="max-w-[280px] truncate font-mono text-xs">
                        {r.path}
                      </TableCell>
                      <TableCell className="text-right">{r.durationMs}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
