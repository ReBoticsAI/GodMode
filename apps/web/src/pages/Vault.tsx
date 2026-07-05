import { useCallback, useEffect, useState } from "react";
import { HardDriveIcon, RefreshCwIcon } from "lucide-react";
import { fetchStorageUsage, type StorageUsageReport } from "@/api";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiSecretsCard } from "@/pages/ai-settings/AiSecretsCard";
import { CursorSubscriptionCard } from "@/pages/ai-settings/CursorSubscriptionCard";

export default function Vault() {
  return (
    <Page>
      <PageHeader
        title="Vault"
        description="Your secrets and storage usage."
      />

      <Tabs defaultValue="secrets" className="w-full">
        <TabsList variant="line" className="w-full flex-wrap justify-start">
          <TabsTrigger value="secrets">Secrets</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
        </TabsList>

        <TabsContent value="secrets" className="mt-4 space-y-4">
          <CursorSubscriptionCard />
          <AiSecretsCard />
        </TabsContent>
        <TabsContent value="storage" className="mt-4">
          <StorageTab />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function StorageTab() {
  const [storage, setStorage] = useState<StorageUsageReport | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);

  const loadStorage = useCallback(() => {
    setStorageBusy(true);
    fetchStorageUsage()
      .then(setStorage)
      .catch((err) => console.error("storage usage failed", err))
      .finally(() => setStorageBusy(false));
  }, []);

  useEffect(() => {
    loadStorage();
  }, [loadStorage]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveIcon className="size-4" />
          Storage
        </CardTitle>
        <CardDescription>
          Database and data-store sizes. Monitor growth before trimming or upgrading stores.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={loadStorage} disabled={storageBusy}>
            <RefreshCwIcon
              data-icon="inline-start"
              className={storageBusy ? "animate-spin" : ""}
            />
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {storage ? (
          <>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                <span className="text-muted-foreground">Platform data total: </span>
                <span className="font-medium">{storage.totalBytesLabel}</span>
              </span>
              {storage.diskFreeBytesLabel && (
                <span>
                  <span className="text-muted-foreground">Disk free: </span>
                  <span className="font-medium">{storage.diskFreeBytesLabel}</span>
                </span>
              )}
            </div>
            <div className="overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Store</th>
                    <th className="px-2 py-1.5 font-medium text-right">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {storage.entries.map((e) => (
                    <tr key={e.id} className="border-b border-border/50 last:border-0">
                      <td className="px-2 py-1.5">
                        <div>{e.label}</div>
                        {e.detail && (
                          <div className="text-[10px] text-muted-foreground">{e.detail}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{e.bytesLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {storage.largestTables.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                  Largest SQLite tables
                </h4>
                <div className="flex flex-wrap gap-2">
                  {storage.largestTables.slice(0, 8).map((t) => (
                    <Badge key={t.name} variant="outline" className="font-mono text-[10px]">
                      {t.name}: {t.rows.toLocaleString()} rows
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {storageBusy ? "Loading storage usage…" : "Storage usage unavailable."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
