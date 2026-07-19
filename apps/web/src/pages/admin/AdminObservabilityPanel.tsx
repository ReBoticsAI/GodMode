import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminBackupStatus,
  fetchAdminObservabilityRequests,
  type AdminRequestLogRow,
} from "@/api";
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

export function AdminObservabilityPanel() {
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [requests, setRequests] = useState<AdminRequestLogRow[]>([]);
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
    ])
      .then(([obs, backupRes]) => {
        setRequests(obs.requests);
        setBackup(backupRes.backup);
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Backup status</CardTitle>
          <CardDescription>
            Latest entry from <code>platform_backup_meta</code>. Cron and
            optional Admin snapshot write here. Soft retention for request logs
            keeps the newest ~5k warn/error rows in core.sqlite.
          </CardDescription>
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
              Hostinger cron.
            </p>
          )}
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
