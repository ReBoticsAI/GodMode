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
  applyOpenRouterToIntelligence,
  connectOpenRouterApiKey,
  disconnectOpenRouterApiKey,
  fetchOpenRouterStatus,
  type OpenRouterAuthStatus,
} from "@/api";

/**
 * OpenRouter usage top-10 snapshot (2026-08-03 weekly tokens).
 * Rankings drift; custom slug field covers anything outside the list.
 */
const OPENROUTER_TOP10 = [
  { id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash 0731" },
  { id: "xiaomi/mimo-v2.5", label: "MiMo-V2.5" },
  { id: "tencent/hy3", label: "Hy3" },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "z-ai/glm-5.2", label: "GLM 5.2" },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron 3 Ultra (free)",
  },
  { id: "minimax/minimax-m3", label: "MiniMax M3" },
  { id: "stepfun/step-3.7-flash", label: "Step 3.7 Flash" },
  { id: "moonshotai/kimi-k3", label: "Kimi K3" },
  { id: "inclusionai/ling-3.0-flash:free", label: "Ling-3.0-flash (free)" },
] as const;

const CUSTOM_VALUE = "__custom__";

/** Connect OpenRouter (metered) API key for Intelligence. */
export function OpenRouterCard({
  vaultAgentId = null,
}: {
  vaultAgentId?: string | null;
}) {
  const [status, setStatus] = useState<OpenRouterAuthStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelChoice, setModelChoice] = useState<string>(OPENROUTER_TOP10[0].id);
  const [customSlug, setCustomSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await fetchOpenRouterStatus(vaultAgentId);
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
      toast.error("Paste your OpenRouter API key");
      return;
    }
    setBusy(true);
    try {
      const res = await connectOpenRouterApiKey(apiKey.trim(), vaultAgentId);
      setApiKey("");
      setStatus(res.status);
      toast.success("OpenRouter connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await disconnectOpenRouterApiKey(vaultAgentId);
      setStatus(res.status);
      toast.success("OpenRouter disconnected");
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
      toast.error("Choose a model or enter a custom OpenRouter slug");
      return;
    }
    setBusy(true);
    try {
      await applyOpenRouterToIntelligence(resolvedModel);
      toast.success(`Intelligence now uses OpenRouter (${resolvedModel})`);
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
          OpenRouter
        </CardTitle>
        <CardDescription>
          Metered OpenRouter API key (BYOK). Models run through OpenAI-compatible transport with
          a family harness (DeepSeek, GLM, Nemotron, MiniMax, Kimi, or generic). Not a Cursor
          subscription.
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
              Create a key in{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                OpenRouter → API keys
                <ExternalLinkIcon className="size-3" />
              </a>
              . Top-10 list is a weekly usage snapshot (2026-08-03); use custom slug for anything
              else.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1">
                <Label className="text-xs">API key</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-…"
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
                onValueChange={(v) => setModelChoice(v ?? OPENROUTER_TOP10[0].id)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPENROUTER_TOP10.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_VALUE}>Custom model slug…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {modelChoice === CUSTOM_VALUE ? (
              <div className="flex flex-col gap-1">
                <Label className="text-xs">OpenRouter model id</Label>
                <Input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="author/model-name"
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void useForIntelligence()}>
                Use OpenRouter for Intelligence
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
