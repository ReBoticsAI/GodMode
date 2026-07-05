import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addCatalogSource,
  fetchInstalledCatalog,
  fetchOfficialCatalog,
  fetchUnofficialCatalog,
  installCatalogEntry,
  removeCatalogSource,
  type CatalogEntry,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/PageHeader";

const OFFICIAL_REPO =
  "https://github.com/ReBoticsAI/GodMode-Marketplace/blob/main/CONTRIBUTING.md";

function EntryCard({
  entry,
  onInstall,
  installing,
}: {
  entry: CatalogEntry;
  onInstall: () => void;
  installing: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{entry.title}</CardTitle>
            <CardDescription className="text-xs">
              {entry.author} · v{entry.version} · {entry.kind}
            </CardDescription>
          </div>
          {entry.sourceName ? (
            <Badge variant="outline">{entry.sourceName}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{entry.description}</p>
        {entry.tags?.length ? (
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-xs">
                {t}
              </Badge>
            ))}
          </div>
        ) : null}
        <Button size="sm" onClick={onInstall} disabled={installing}>
          {installing ? "Installing…" : "Install"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function MarketplacePage() {
  const [tab, setTab] = useState("official");
  const [official, setOfficial] = useState<CatalogEntry[]>([]);
  const [unofficial, setUnofficial] = useState<CatalogEntry[]>([]);
  const [sources, setSources] = useState<Array<{ id: string; name: string; url: string }>>(
    []
  );
  const [installed, setInstalled] = useState<Array<Record<string, unknown>>>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [off, unoff, inst] = await Promise.all([
        fetchOfficialCatalog(),
        fetchUnofficialCatalog(),
        fetchInstalledCatalog(),
      ]);
      setOfficial(off.entries);
      setUnofficial(unoff.entries);
      setSources(unoff.sources);
      setInstalled(inst.catalogInstalls);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load marketplace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filterEntries = (entries: CatalogEntry[]) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(needle) ||
        e.description.toLowerCase().includes(needle) ||
        e.tags?.some((t) => t.toLowerCase().includes(needle))
    );
  };

  const officialFiltered = useMemo(() => filterEntries(official), [official, q]);
  const unofficialFiltered = useMemo(() => filterEntries(unofficial), [unofficial, q]);

  const handleInstall = async (entry: CatalogEntry) => {
    setInstallingId(entry.id);
    try {
      const result = await installCatalogEntry(entry.id, entry.sourceCatalog);
      toast.success(`Installed ${entry.title}`);
      if (result.restartRequired) {
        toast.info("Restart Bridge to load the plugin");
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstallingId(null);
    }
  };

  const handleAddSource = async () => {
    if (!sourceName.trim() || !sourceUrl.trim()) return;
    try {
      await addCatalogSource(sourceName.trim(), sourceUrl.trim());
      setSourceName("");
      setSourceUrl("");
      await reload();
      toast.success("Catalog source added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add source");
    }
  };

  return (
    <Page>
      <PageHeader
        title="Marketplace"
        description="Install free packs from the official catalog or add unofficial plugin sources."
        actions={
          <Button variant="outline" size="sm" render={<a href={OFFICIAL_REPO} target="_blank" rel="noreferrer" />}>
            Submit to Official
          </Button>
        }
      />

      <div className="mb-4 flex gap-2">
        <Input
          placeholder="Search listings…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" onClick={() => void reload()}>
          Refresh
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="official">Official</TabsTrigger>
          <TabsTrigger value="unofficial">Unofficial</TabsTrigger>
          <TabsTrigger value="installed">Installed</TabsTrigger>
        </TabsList>

        <TabsContent value="official" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading official catalog…</p>
          ) : officialFiltered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No official listings found. Check your network or set MARKETPLACE_LOCAL_CATALOG_PATH
              for local dev.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {officialFiltered.map((entry) => (
                <EntryCard
                  key={`official-${entry.id}`}
                  entry={entry}
                  installing={installingId === entry.id}
                  onInstall={() => void handleInstall(entry)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="unofficial" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add catalog or plugin repo</CardTitle>
              <CardDescription>
                Point to a catalog index.json URL or a GitHub repo with a godmode.plugin.json
                manifest.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>URL</Label>
                <Input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://raw.githubusercontent.com/…/catalog/index.json"
                />
              </div>
              <Button className="sm:col-span-2 w-fit" onClick={() => void handleAddSource()}>
                Add source
              </Button>
            </CardContent>
          </Card>

          {sources.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Your sources</p>
              {sources.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span>
                    {s.name} · <span className="text-muted-foreground">{s.url}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void removeCatalogSource(s.id).then(() => reload())
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {unofficialFiltered.map((entry) => (
              <EntryCard
                key={`unofficial-${entry.id}-${entry.sourceCatalog}`}
                entry={entry}
                installing={installingId === entry.id}
                onInstall={() => void handleInstall(entry)}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="installed" className="mt-4">
          {installed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No catalog installs yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {installed.map((row) => (
                <li key={String(row.id)} className="rounded-md border px-3 py-2">
                  <span className="font-medium">{String(row.entry_title)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {String(row.install_type)} · {String(row.installed_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
