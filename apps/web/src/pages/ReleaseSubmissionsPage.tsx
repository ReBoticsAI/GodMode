import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLinkIcon, RefreshCwIcon, RocketIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchReleaseSubmissions,
  refreshReleaseSubmission,
  type ReleaseSubmission,
  type ReleaseSubmissionMetrics,
} from "@/api";
import { CODING_PATH, VAULT_PATH } from "@/lib/navigation";
import { toast } from "sonner";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "secondary",
  staged: "outline",
  published: "default",
  failed: "destructive",
};

export default function ReleaseSubmissionsPage() {
  const [rows, setRows] = useState<ReleaseSubmission[]>([]);
  const [metrics, setMetrics] = useState<ReleaseSubmissionMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchReleaseSubmissions();
      setRows(res.submissions);
      setMetrics(res.metrics);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load releases");
      setRows([]);
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onRefresh = async (id: string) => {
    setRefreshingId(id);
    try {
      await refreshReleaseSubmission(id);
      toast.success("Metrics refreshed");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Release submissions"
        description="Ship-from-GodMode status for GitHub Releases. Connect GitHub in Vault, then use github_release_prepare / create (draft) / publish from Coding."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<Link to={`${VAULT_PATH}?tab=integrations`} />}>
              Vault Connect
            </Button>
            <Button variant="outline" render={<Link to={CODING_PATH} />}>
              Coding
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void reload()}
              disabled={loading}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Reload
            </Button>
          </div>
        }
      />

      {metrics ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Total" value={metrics.total} />
          <Metric label="Draft" value={metrics.draft} />
          <Metric label="Published" value={metrics.published} />
          <Metric label="Failed" value={metrics.failed} />
          <Metric label="Downloads" value={metrics.downloadCount} />
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <RocketIcon className="size-8 text-muted-foreground" />
            <EmptyTitle>No release submissions yet</EmptyTitle>
            <EmptyDescription>
              Prepare a draft with github_release_prepare or github_release_create
              after connecting GitHub. This page is separate from Admin Updates
              (consumer install poller).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Repo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Downloads</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.title || row.tag}
                    <div className="text-xs text-muted-foreground">{row.tag}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.owner}/{row.repo}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>
                      {row.status}
                    </Badge>
                    {row.error ? (
                      <p className="mt-1 max-w-xs truncate text-xs text-destructive">
                        {row.error}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.download_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.updated_at}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {row.html_url ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          render={
                            <a
                              href={row.html_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          }
                        >
                          <ExternalLinkIcon data-icon="inline-start" />
                          GitHub
                        </Button>
                      ) : null}
                      {row.github_release_id ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={refreshingId === row.id}
                          onClick={() => void onRefresh(row.id)}
                        >
                          <RefreshCwIcon data-icon="inline-start" />
                          Metrics
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Page>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
