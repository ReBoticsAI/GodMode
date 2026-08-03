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
  applyTogetherToIntelligence,
  connectTogetherApiKey,
  disconnectTogetherApiKey,
  fetchTogetherStatus,
  type TogetherAuthStatus,
} from "@/api";

/**
 * Together serverless chat catalog snapshot (2026-08-03).
 * Custom slug covers anything outside the list.
 */
const TOGETHER_CHAT = [
  { id: "MiniMaxAI/MiniMax-M3", label: "MiniMax M3" },
  {
    id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    label: "Llama 3.3 70B Instruct Turbo",
  },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "deepseek-ai/DeepSeek-V4-Pro", label: "DeepSeek V4 Pro" },
  { id: "moonshotai/Kimi-K3", label: "Kimi K3" },
  { id: "Qwen/Qwen3.5-9B", label: "Qwen3.5 9B" },
] as const;

const CUSTOM_VALUE = "__custom__";

/** Connect Together AI (metered) API key for Intelligence. */
export function TogetherCard() {
  const [status, setStatus] = useState<TogetherAuthStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelChoice, setModelChoice] = useState<string>(TOGETHER_CHAT[0].id);
  const [customSlug, setCustomSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await fetchTogetherStatus();
      setStatus(s);
    } catch {
      setStatus({ connected: false, source: "none" });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connect = async () => {
    if (!apiKey.trim()) {
      toast.error("Paste your Together API key");
      return;
    }
    setBusy(true);
    try {
      const res = await connectTogetherApiKey(apiKey.trim());
      setApiKey("");
      setStatus(res.status);
      toast.success("Together connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await disconnectTogetherApiKey();
      setStatus(res.status);
      toast.success("Together disconnected");
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
      toast.error("Choose a model or enter a custom Together model id");
      return;
    }
    setBusy(true);
    try {
      await applyTogetherToIntelligence(resolvedModel);
      toast.success(`Intelligence now uses Together (${resolvedModel})`);
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
          Together
        </CardTitle>
        <CardDescription>
          Metered Together AI API key (BYOK). Models run through OpenAI-compatible transport with
          a family harness (Llama, GPT-OSS, DeepSeek, Qwen, Kimi, MiniMax, or generic). Not a
          Cursor subscription.
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
                href="https://api.together.ai/settings/api-keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Together → API keys
                <ExternalLinkIcon className="size-3" />
              </a>
              . Catalog is a serverless chat snapshot (2026-08-03); use custom id for anything
              else.
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
                onValueChange={(v) => setModelChoice(v ?? TOGETHER_CHAT[0].id)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOGETHER_CHAT.map((m) => (
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
                <Label className="text-xs">Together model id</Label>
                <Input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="meta-llama/Llama-3.3-70B-Instruct-Turbo"
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void useForIntelligence()}>
                Use Together for Intelligence
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
