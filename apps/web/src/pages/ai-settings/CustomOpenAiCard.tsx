import { useCallback, useEffect, useState } from "react";
import { KeyRoundIcon } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  applyCustomOpenAiToIntelligence,
  connectCustomOpenAi,
  disconnectCustomOpenAi,
  fetchCustomOpenAiStatus,
  type CustomOpenAiAuthStatus,
} from "@/api";

/** Connect any OpenAI-compatible endpoint (base URL + key) for Intelligence. */
export function CustomOpenAiCard({
  vaultAgentId = null,
}: {
  vaultAgentId?: string | null;
}) {
  const [status, setStatus] = useState<CustomOpenAiAuthStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await fetchCustomOpenAiStatus(vaultAgentId);
      setStatus(s);
      if (s.baseUrl) setBaseUrl(s.baseUrl);
    } catch {
      setStatus({ connected: false, source: "none" });
    }
  }, [vaultAgentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connect = async () => {
    if (!baseUrl.trim()) {
      toast.error("Enter the OpenAI-compatible base URL");
      return;
    }
    if (!apiKey.trim()) {
      toast.error("Paste your API key");
      return;
    }
    setBusy(true);
    try {
      const res = await connectCustomOpenAi(
        apiKey.trim(),
        baseUrl.trim(),
        vaultAgentId
      );
      setApiKey("");
      setStatus(res.status);
      if (res.status.baseUrl) setBaseUrl(res.status.baseUrl);
      toast.success("Custom OpenAI-compatible endpoint connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await disconnectCustomOpenAi(vaultAgentId);
      setStatus(res.status);
      toast.success("Custom endpoint disconnected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  };

  const useForIntelligence = async () => {
    if (!modelId.trim()) {
      toast.error("Enter a model id for this endpoint");
      return;
    }
    setBusy(true);
    try {
      await applyCustomOpenAiToIntelligence(modelId.trim());
      toast.success(`Intelligence now uses custom endpoint (${modelId.trim()})`);
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
          <KeyRoundIcon className="size-4" />
          Custom OpenAI-compatible
        </CardTitle>
        <CardDescription>
          Escape hatch for any OpenAI-compatible base URL + API key. Prefer named
          provider cards when available. Uses a generic custom-openai harness.
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
        </div>

        {!status?.connected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Base URL should be the chat-completions root (for example{" "}
              <span className="font-mono text-xs">https://host/v1</span>
              ), not the full <span className="font-mono text-xs">/chat/completions</span>{" "}
              path.
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Base URL</Label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://example.com/v1"
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-1">
                  <Label className="text-xs">API key</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="…"
                    autoComplete="off"
                  />
                </div>
                <Button type="button" disabled={busy} onClick={() => void connect()}>
                  Connect
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            {status.baseUrl ? (
              <p className="font-mono text-xs text-muted-foreground break-all">
                {status.baseUrl}
              </p>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Model id for Intelligence</Label>
              <Input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="model-id"
                autoComplete="off"
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void useForIntelligence()}>
                Use custom endpoint for Intelligence
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
