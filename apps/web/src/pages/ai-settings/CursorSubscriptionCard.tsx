import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  applyCursorToIntelligence,
  connectCursorApiKey,
  disconnectCursorApiKey,
  fetchCursorModels,
  fetchCursorStatus,
  type CursorAuthStatus,
  type CursorModelOption,
} from "@/api";

/** Connect Cursor subscription for Intelligence (Composer, Auto, etc.). */
export function CursorSubscriptionCard() {
  const [status, setStatus] = useState<CursorAuthStatus | null>(null);
  const [models, setModels] = useState<CursorModelOption[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("auto");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await fetchCursorStatus();
      setStatus(s);
      if (s.connected) {
        const m = await fetchCursorModels();
        setModels(m.models);
        if (m.models.some((x) => x.id === model)) {
          /* keep selection */
        } else if (m.models[0]) {
          setModel(m.models[0].id);
        }
      } else {
        setModels([]);
      }
    } catch {
      setStatus({ connected: false, source: "none" });
      setModels([]);
    }
  }, [model]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connect = async () => {
    if (!apiKey.trim()) {
      toast.error("Paste your Cursor API key");
      return;
    }
    setBusy(true);
    try {
      await connectCursorApiKey(apiKey.trim());
      setApiKey("");
      toast.success("Cursor connected");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectCursorApiKey();
      toast.success("Cursor disconnected");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  };

  const useForIntelligence = async () => {
    setBusy(true);
    try {
      await applyCursorToIntelligence(model);
      toast.success(`Intelligence now uses Cursor (${model})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4" />
          Cursor subscription
        </CardTitle>
        <CardDescription>
          Use your Cursor plan models (Auto, Composer 2.5, and others) inside GodMode
          Intelligence with native tools — billed to your Cursor account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status?.connected ? "default" : "secondary"}>
            {status?.connected ? "Connected" : "Not connected"}
          </Badge>
          {status?.connected && status.masked ? (
            <span className="font-mono text-xs text-muted-foreground">{status.masked}</span>
          ) : null}
          {status?.cliAuthenticated ? (
            <Badge variant="outline" className="text-[10px]">
              CLI session
            </Badge>
          ) : null}
        </div>

        {!status?.connected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Generate a user API key from{" "}
              <a
                href="https://cursor.com/dashboard?tab=integrations"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Cursor Dashboard → Integrations
                <ExternalLinkIcon className="size-3" />
              </a>
              . This uses the same subscription as Cursor IDE.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1">
                <Label className="text-xs">API key</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="cur_…"
                />
              </div>
              <Button type="button" disabled={busy} onClick={() => void connect()}>
                Connect
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Model for Intelligence</Label>
              <Select value={model} onValueChange={(v) => setModel(v ?? "auto")}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(models.length ? models : [{ id: "auto", label: "Auto" }]).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void useForIntelligence()}>
                Use Cursor for Intelligence
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Sets Intelligence backend to Cursor Cloud. You can also pick{" "}
              <span className="font-mono">Cursor subscription</span> per agent under Agents →
              Pipeline → Backend.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
