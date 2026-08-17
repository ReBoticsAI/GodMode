import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLinkIcon, RefreshCwIcon, RocketIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
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
  fetchPublisherConnectors,
  fetchReleaseSubmissions,
  refreshReleaseSubmission,
  type PublisherConnector,
  type ReleaseSubmission,
  type ReleaseSubmissionMetrics,
} from "@/api";
import { CODING_PATH, MARKETPLACE_PATH, VAULT_PATH } from "@/lib/navigation";
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

function isContentsPermissionFailure(error: string | null | undefined): boolean {
  const m = String(error ?? "");
  return (
    /Resource not accessible by integration/i.test(m) ||
    /Contents write/i.test(m) ||
    (/reconnect GitHub/i.test(m) && /Vault/i.test(m))
  );
}

export default function ReleaseSubmissionsPage() {
  const [rows, setRows] = useState<ReleaseSubmission[]>([]);
  const [metrics, setMetrics] = useState<ReleaseSubmissionMetrics | null>(null);
  const [connectors, setConnectors] = useState<PublisherConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [res, catalog] = await Promise.all([
        fetchReleaseSubmissions(),
        fetchPublisherConnectors(),
      ]);
      setRows(res.submissions);
      setMetrics(res.metrics);
      setConnectors(catalog.connectors);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load releases");
      setRows([]);
      setMetrics(null);
      setConnectors([]);
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
        description="Ship-from-GodMode status for GitHub Releases. Connect GitHub in Vault, then use github_release_prepare / create (draft) / publish from Coding. Other stores and channels install as plugins."
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

      {connectors.length > 0 ? (
        <Card size="sm" className="mb-4">
          <CardHeader>
            <CardTitle>Publisher connectors</CardTitle>
            <CardDescription>
              Install from this catalog. GitHub Releases is Core. Further networks
              ship as Marketplace or Intelligence-built plugins.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {connectors.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.title}</span>
                  <Badge variant="outline">{c.kind}</Badge>
                  <Badge variant="secondary">{c.source}</Badge>
                  {c.pagePath ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      render={<Link to={c.pagePath} />}
                    >
                      Open
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      render={<Link to={MARKETPLACE_PATH} />}
                    >
                      Marketplace
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">{c.description}</p>
                <p className="text-muted-foreground text-xs">{c.installHint}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {metrics ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Total" value={metrics.total} />
          <Metric label="Draft" value={metrics.draft} />
          <Metric label="Published" value={metrics.published} />
          <Metric label="Failed" value={metrics.failed} />
          <Metric label="Downloads" value={metrics.downloadCount} />
        </div>
      ) : null}

      {rows.some((r) => r.status === "failed" && isContentsPermissionFailure(r.error)) ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Reconnect GitHub with Contents write</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              A release create failed because the GitHub App installation lacks
              Contents write (or the new permission was not accepted yet).
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              render={<Link to={`${VAULT_PATH}?tab=integrations`} />}
            >
              Open Vault Integrations
            </Button>
          </AlertDescription>
        </Alert>
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
