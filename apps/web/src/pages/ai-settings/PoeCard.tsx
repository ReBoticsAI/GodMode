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
  applyPoeToIntelligence,
  connectPoeApiKey,
  disconnectPoeApiKey,
  fetchPoeStatus,
  type PoeAuthStatus,
} from "@/api";

/**
 * Poe catalog snapshot (2026-08-03).
 * Prefer chat/completions-compatible bot ids; custom slug allowed.
 */
const POE_CHAT = [
  { id: "Claude-Sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "GPT-4o", label: "GPT-4o" },
  { id: "Gemini-2.5-Pro", label: "Gemini 2.5 Pro" },
  { id: "Llama-3.1-405B", label: "Llama 3.1 405B" },
] as const;

const CUSTOM_VALUE = "__custom__";

/** Connect Poe (subscription compute points API) for Intelligence. */
export function PoeCard({
  vaultAgentId = null,
}: {
  vaultAgentId?: string | null;
}) {
  const [status, setStatus] = useState<PoeAuthStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelChoice, setModelChoice] = useState<string>(POE_CHAT[0].id);
  const [customSlug, setCustomSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await fetchPoeStatus(vaultAgentId);
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
      toast.error("Paste your Poe API key");
      return;
    }
    setBusy(true);
    try {
      const res = await connectPoeApiKey(apiKey.trim(), vaultAgentId);
      setApiKey("");
      setStatus(res.status);
      toast.success("Poe connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await disconnectPoeApiKey(vaultAgentId);
      setStatus(res.status);
      toast.success("Poe disconnected");
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
      toast.error("Choose a model or enter a custom Poe bot id");
      return;
    }
    setBusy(true);
    try {
      await applyPoeToIntelligence(resolvedModel);
      toast.success(`Intelligence now uses Poe (${resolvedModel})`);
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
          Poe
        </CardTitle>
        <CardDescription>
          API key that spends your Poe subscription compute points. Models run
          through OpenAI-compatible transport with a Poe harness. Per-tenant keys
          only. Points deduct from the key owner&apos;s Poe account.
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
              Create a key at{" "}
              <a
                href="https://poe.com/api/keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Poe API keys
                <ExternalLinkIcon className="size-3" />
              </a>
              . Prefer chat/completions-compatible bot ids; use custom for others.
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
                onValueChange={(v) => setModelChoice(v ?? POE_CHAT[0].id)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POE_CHAT.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_VALUE}>Custom bot id…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {modelChoice === CUSTOM_VALUE ? (
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Poe bot id</Label>
                <Input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="Claude-Sonnet-4.6"
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void useForIntelligence()}>
                Use Poe for Intelligence
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
