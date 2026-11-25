import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, CreditCardIcon } from "lucide-react";
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
  applyOpencodeConsoleToIntelligence,
  connectOpencodeConsoleApiKey,
  disconnectOpencodeConsoleApiKey,
  fetchOpencodeConsoleModels,
  fetchOpencodeConsoleStatus,
  type OpencodeConsoleAuthStatus,
} from "@/api";
import { ProviderConnectMethodBadges } from "@/pages/ai-settings/provider-connect-methods";

/**
 * OpenCode Console catalog snapshot (2026-11-16).
 * Keep in sync with OPENCODE_CONSOLE_CHAT_CATALOG in
 * apps/bridge/src/services/opencode-console-platform.ts.
 * The live list (fetched with your key) is merged in when available.
 */
const OPENCODE_CONSOLE_CHAT = [
  { id: "kimi-k3", label: "Kimi K3" },
  { id: "gpt-6.1-sol", label: "GPT 6.1 Sol" },
  { id: "glm-5.3", label: "GLM 5.3" },
  { id: "glm-5.3-flash", label: "GLM 5.3 Flash" },
  { id: "gpt-6-luna", label: "GPT 6 Luna" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { id: "grok-4.7", label: "Grok 4.7" },
  { id: "qwen3.8-max", label: "Qwen3.8 Max" },
] as const;

const CUSTOM_VALUE = "__custom__";

/** Connect OpenCode Console (metered payg key) for Intelligence. */
export function OpencodeConsoleCard({
  vaultAgentId = null,
}: {
  vaultAgentId?: string | null;
}) {
  const [status, setStatus] = useState<OpencodeConsoleAuthStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelChoice, setModelChoice] = useState<string>(
    OPENCODE_CONSOLE_CHAT[0].id
  );
  const [customSlug, setCustomSlug] = useState("");
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await fetchOpencodeConsoleStatus(vaultAgentId);
      setStatus(s);
      if (s.connected) {
        // Models the key can actually use (workspace model access governs this).
        setLiveModels(await fetchOpencodeConsoleModels());
      } else {
        setLiveModels([]);
      }
    } catch {
      setStatus({ connected: false, source: "none" });
      setLiveModels([]);
    }
  }, [vaultAgentId]);

  /** Refetch on dropdown open so a failed mount-time fetch retries. */
  const onModelSelectOpenChange = useCallback(
    (open: boolean) => {
      if (open && status?.connected && liveModels.length === 0) {
        void fetchOpencodeConsoleModels().then(setLiveModels);
      }
    },
    [status?.connected, liveModels.length]
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const connect = async () => {
    if (!apiKey.trim()) {
      toast.error("Paste your OpenCode Console API key");
      return;
    }
    setBusy(true);
    try {
      const res = await connectOpencodeConsoleApiKey(
        apiKey.trim(),
        vaultAgentId
      );
      setApiKey("");
      setStatus(res.status);
      setLiveModels(await fetchOpencodeConsoleModels());
      toast.success("OpenCode Console connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await disconnectOpencodeConsoleApiKey(vaultAgentId);
      setStatus(res.status);
      toast.success("OpenCode Console disconnected");
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
      toast.error("Choose a model or enter a custom OpenCode Console model id");
      return;
    }
    setBusy(true);
    try {
      await applyOpencodeConsoleToIntelligence(resolvedModel);
      toast.success(
        `Intelligence now uses OpenCode Console (${resolvedModel})`
      );
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
          <CreditCardIcon className="size-4" />
          OpenCode Console
        </CardTitle>
        <CardDescription>
          Metered pay-as-you-go key from the OpenCode Console. Models run through
          the OpenAI-compatible inference endpoint with a Console harness. Which
          models your key can use is governed by workspace model access in the
          Console. Not OpenCode Go (subscription) and not OpenCode Zen.
        </CardDescription>
        <ProviderConnectMethodBadges providerId="opencode-console" />
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
              Sign in, add credits, and copy your key from{" "}
              <a
                href="https://opencode.ai/console"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                OpenCode Console
                <ExternalLinkIcon className="size-3" />
              </a>
              . Prefer chat/completions-compatible model ids; use custom for others.
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
                onValueChange={(v) => setModelChoice(v ?? OPENCODE_CONSOLE_CHAT[0].id)}
                onOpenChange={onModelSelectOpenChange}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {liveModels.map((id) => (
                    <SelectItem key={`live-${id}`} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                  {OPENCODE_CONSOLE_CHAT.filter(
                    (m) => !liveModels.includes(m.id)
                  ).map((m) => (
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
                <Label className="text-xs">OpenCode Console model id</Label>
                <Input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="kimi-k3"
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void useForIntelligence()}>
                Use OpenCode Console for Intelligence
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
