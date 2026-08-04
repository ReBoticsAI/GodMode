import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, WavesIcon } from "lucide-react";
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
  applyDigitalOceanInferenceToIntelligence,
  connectDigitalOceanInferenceApiKey,
  disconnectDigitalOceanInferenceApiKey,
  fetchDigitalOceanInferenceStatus,
  type DigitalOceanInferenceAuthStatus,
} from "@/api";

/**
 * DigitalOcean Inference chat catalog snapshot (2026-08-04).
 * Prefer chat/completions-compatible ids; custom slug allowed.
 */
const DO_INFERENCE_CHAT = [
  { id: "llama3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
  { id: "openai-gpt-4o", label: "GPT-4o" },
  { id: "anthropic-claude-4.5-sonnet", label: "Claude Sonnet 4.5" },
  { id: "deepseek-4-flash", label: "DeepSeek V4 Flash" },
  { id: "kimi-k3", label: "Kimi K3" },
] as const;

const CUSTOM_VALUE = "__custom__";

/** Connect DigitalOcean Gradient Inference (model access key) for Intelligence. */
export function DigitalOceanInferenceCard({
  vaultAgentId = null,
}: {
  vaultAgentId?: string | null;
}) {
  const [status, setStatus] = useState<DigitalOceanInferenceAuthStatus | null>(
    null
  );
  const [apiKey, setApiKey] = useState("");
  const [modelChoice, setModelChoice] = useState<string>(DO_INFERENCE_CHAT[0].id);
  const [customSlug, setCustomSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await fetchDigitalOceanInferenceStatus(vaultAgentId);
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
      toast.error("Paste your DigitalOcean model access key");
      return;
    }
    setBusy(true);
    try {
      const res = await connectDigitalOceanInferenceApiKey(
        apiKey.trim(),
        vaultAgentId
      );
      setApiKey("");
      setStatus(res.status);
      toast.success("DigitalOcean Inference connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await disconnectDigitalOceanInferenceApiKey(vaultAgentId);
      setStatus(res.status);
      toast.success("DigitalOcean Inference disconnected");
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
      toast.error("Choose a model or enter a custom DigitalOcean model id");
      return;
    }
    setBusy(true);
    try {
      await applyDigitalOceanInferenceToIntelligence(resolvedModel);
      toast.success(
        `Intelligence now uses DigitalOcean Inference (${resolvedModel})`
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
          <WavesIcon className="size-4" />
          DigitalOcean Inference
        </CardTitle>
        <CardDescription>
          Gradient Serverless Inference model access key. OpenAI-compatible
          transport at inference.do-ai.run. Per-tenant keys only. Not account
          OAuth.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status?.connected ? "default" : "secondary"}>
            {status?.connected ? "Connected" : "Not connected"}
          </Badge>
          {status?.connected && status.masked ? (
            <span className="font-mono text-xs text-muted-foreground">
              {status.masked}
            </span>
          ) : null}
        </div>

        {!status?.connected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Create a model access key in{" "}
              <a
                href="https://cloud.digitalocean.com/gen-ai/inference"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                DigitalOcean Inference
                <ExternalLinkIcon className="size-3" />
              </a>
              . Prefer chat/completions-compatible model ids; use custom for
              others.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1">
                <Label className="text-xs">Model access key</Label>
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
                onValueChange={(v) =>
                  setModelChoice(v ?? DO_INFERENCE_CHAT[0].id)
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DO_INFERENCE_CHAT.map((m) => (
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
                <Label className="text-xs">DigitalOcean model id</Label>
                <Input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="llama3.3-70b-instruct"
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void useForIntelligence()}
              >
                Use DigitalOcean Inference for Intelligence
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
