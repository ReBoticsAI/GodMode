import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/api";

interface PluginRow {
  plugin_id: string;
  version: string;
  installed_at: string;
}

interface AvailablePlugin {
  id: string;
  version: string;
  name: string;
  pluginRoot: string;
  loaded: boolean;
}

interface PluginsResponse {
  installed: PluginRow[];
  available: AvailablePlugin[];
  loaded: string[];
}

export function PluginsPanel() {
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await api<PluginsResponse>("/plugins");
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plugins");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = async (pluginId: string) => {
    setBusy(pluginId);
    try {
      await api("/plugins/install", {
        method: "POST",
        body: JSON.stringify({ pluginId }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install failed");
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async (pluginId: string) => {
    setBusy(pluginId);
    try {
      await api("/plugins/uninstall", {
        method: "POST",
        body: JSON.stringify({ pluginId }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uninstall failed");
    } finally {
      setBusy(null);
    }
  };

  const installedIds = new Set(data?.installed.map((r) => r.plugin_id) ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plugins</CardTitle>
        <CardDescription>
          Optional domain packs discovered from sibling plugin repos on Desktop (auto-discover)
          or <code className="text-xs">GODMODE_PLUGIN_PATH</code>. Restart Bridge after adding plugins.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && (
          <p className="text-sm text-muted-foreground">Loading plugins…</p>
        )}
        {data && (
          <>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Available</h3>
              {data.available.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No plugin directories found. Clone plugin repos as Desktop siblings or set{" "}
                  <code className="text-xs">GODMODE_PLUGIN_PATH</code>, then restart Bridge.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.available.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium">{p.name}</span>{" "}
                        <span className="text-muted-foreground">({p.id})</span>
                        {!p.loaded && (
                          <span className="ml-2 text-xs text-amber-600">
                            not loaded — restart Bridge
                          </span>
                        )}
                      </div>
                      {installedIds.has(p.id) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy === p.id}
                          onClick={() => void uninstall(p.id)}
                        >
                          Uninstall
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={!p.loaded || busy === p.id}
                          onClick={() => void install(p.id)}
                        >
                          Install
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {data.installed.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Installed on this workspace</h3>
                <ul className="text-sm text-muted-foreground">
                  {data.installed.map((row) => (
                    <li key={row.plugin_id}>
                      {row.plugin_id} @ {row.version}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
