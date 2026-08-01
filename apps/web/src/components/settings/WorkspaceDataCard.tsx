import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { downloadTenantDatabase, fetchBridgeHealth } from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Owner self-serve export of the active workspace SQLite (#235).
 * Distinct from Admin platform backup download (#243).
 */
export function WorkspaceDataCard() {
  const { tenants, activeTenantId } = useTenant();
  const [saas, setSaas] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const health = await fetchBridgeHealth();
        if (!cancelled) setSaas(Boolean(health.saas));
      } catch {
        if (!cancelled) setSaas(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const role = tenants.find((t) => t.id === activeTenantId)?.role;
  const isOwner = role === "owner";

  // Local/desktop already has the file on disk; Cloud is the self-serve path.
  if (!saas || !isOwner) return null;

  const onDownload = async () => {
    setBusy(true);
    try {
      await downloadTenantDatabase();
      toast.success("Workspace database download started");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not download database"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace data</CardTitle>
        <CardDescription>
          Download a consistent snapshot of this workspace SQLite file to run
          GodMode locally. The file may include vault secrets, chat, and
          holdings. Keep it private. Matching or newer GodMode versions are
          required to open it; older desktop builds may need a schema migration.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          This exports only your workspace database (not platform analytics
          DuckDB, and not other tenants). Rate-limited; downloads are audited.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void onDownload()}
        >
          <DownloadIcon data-icon="inline-start" />
          {busy ? "Preparing download…" : "Download my database"}
        </Button>
      </CardContent>
    </Card>
  );
}
