import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, KeyRoundIcon } from "lucide-react";
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
  applyMinimaxToIntelligence,
  connectMinimaxApiKey,
  disconnectMinimaxApiKey,
  fetchMinimaxStatus,
  type MinimaxAuthStatus,
} from "@/api";

/**
 * MiniMax payg chat catalog snapshot (2026-08-03).
 * Custom slug covers anything outside the list.
 */
const MINIMAX_CHAT = [
  { id: "MiniMax-M3", label: "MiniMax M3" },
  { id: "MiniMax-M2.7", label: "MiniMax M2.7" },
  { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
] as const;

const CUSTOM_VALUE = "__custom__";

/** Connect MiniMax payg (metered interface key) for Intelligence. */
export function MinimaxPaygCard({
  vaultAgentId = null,
}: {
  vaultAgentId?: string | null;
}) {
  const [status, setStatus] = useState<MinimaxAuthStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelChoice, setModelChoice] = useState<string>(MINIMAX_CHAT[0].id);
  const [customSlug, setCustomSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await fetchMinimaxStatus(vaultAgentId);
      setStatus(s);
    } catch {
      setStatus({ connected: false, source: "none" });
    }
  }, [vaultAgentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connect = async () => {
    if (!apiKey.trim()) {
      toast.error("Paste your MiniMax interface API key");
      return;
    }
    setBusy(true);
    try {
      const res = await connectMinimaxApiKey(apiKey.trim(), vaultAgentId);
      setApiKey("");
      setStatus(res.status);
      toast.success("MiniMax connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await disconnectMinimaxApiKey(vaultAgentId);
      setStatus(res.status);
      toast.success("MiniMax disconnected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  };

  const resolvedModel =
    modelChoice === CUSTOM_VALUE ? customSlug.trim() : modelChoice;

  const useForIntelligence = async () => {
    if (!resolvedModel) {
      toast.error("Choose a model or enter a custom MiniMax model id");
      return;
    }
    setBusy(true);
    try {
      await applyMinimaxToIntelligence(resolvedModel);
      toast.success(`Intelligence now uses MiniMax (${resolvedModel})`);
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
          MiniMax
        </CardTitle>
        <CardDescription>
          Metered MiniMax interface key (BYOK). Uses OpenAI-compatible transport
          with a MiniMax harness. Not Token Plan subscription keys (those belong
          under Subscriptions when shipped).
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
              Create an interface key in{" "}
              <a
                href="https://platform.minimax.io/user-center/basic-information/interface-key"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                MiniMax → API Keys
                <ExternalLinkIcon className="size-3" />
              </a>
              . Catalog uses common M-series ids; use custom id for newer
              releases.
            </p>
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
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Model for Intelligence</Label>
              <Select
                value={modelChoice}
                onValueChange={(v) => setModelChoice(v ?? MINIMAX_CHAT[0].id)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINIMAX_CHAT.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_VALUE}>Custom model id…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {modelChoice === CUSTOM_VALUE ? (
              <div className="flex flex-col gap-1">
                <Label className="text-xs">MiniMax model id</Label>
                <Input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="MiniMax-M3"
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void useForIntelligence()}>
                Use MiniMax for Intelligence
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
