import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, SnowflakeIcon } from "lucide-react";
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
  applySnowflakeCortexToIntelligence,
  connectSnowflakeCortex,
  disconnectSnowflakeCortex,
  fetchSnowflakeCortexStatus,
  type SnowflakeCortexAuthStatus,
} from "@/api";

/**
 * Snowflake Cortex chat catalog snapshot (2026-08-04).
 * Prefer Chat Completions ids; custom slug allowed.
 */
const SNOWFLAKE_CORTEX_CHAT = [
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "llama3.1-70b", label: "Llama 3.1 70B" },
  { id: "mistral-large2", label: "Mistral Large 2" },
  { id: "openai-gpt-4.1", label: "GPT-4.1" },
] as const;

const CUSTOM_VALUE = "__custom__";

/** Connect Snowflake Cortex via PAT + account URL (no browser OAuth). */
export function SnowflakeCortexCard({
  vaultAgentId = null,
}: {
  vaultAgentId?: string | null;
}) {
  const [status, setStatus] = useState<SnowflakeCortexAuthStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [accountUrl, setAccountUrl] = useState("");
  const [modelChoice, setModelChoice] = useState<string>(
    SNOWFLAKE_CORTEX_CHAT[0].id
  );
  const [customSlug, setCustomSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await fetchSnowflakeCortexStatus(vaultAgentId);
      setStatus(s);
      if (s.baseUrl) setAccountUrl(s.baseUrl);
    } catch {
      setStatus({ connected: false, source: "none" });
    }
  }, [vaultAgentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connect = async () => {
    if (!accountUrl.trim()) {
      toast.error("Enter your Snowflake account URL or identifier");
      return;
    }
    if (!apiKey.trim()) {
      toast.error("Paste your Snowflake programmatic access token (PAT)");
      return;
    }
    setBusy(true);
    try {
      const res = await connectSnowflakeCortex(
        apiKey.trim(),
        accountUrl.trim(),
        vaultAgentId
      );
      setApiKey("");
      setStatus(res.status);
      if (res.status.baseUrl) setAccountUrl(res.status.baseUrl);
      toast.success("Snowflake Cortex connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await disconnectSnowflakeCortex(vaultAgentId);
      setStatus(res.status);
      toast.success("Snowflake Cortex disconnected");
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
      toast.error("Choose a model or enter a custom Cortex model id");
      return;
    }
    setBusy(true);
    try {
      await applySnowflakeCortexToIntelligence(resolvedModel);
      toast.success(`Intelligence now uses Snowflake Cortex (${resolvedModel})`);
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
          <SnowflakeIcon className="size-4" />
          Snowflake Cortex
        </CardTitle>
        <CardDescription>
          Programmatic access token (PAT) plus account URL. Routes to the Cortex
          OpenAI-compatible API. Per-tenant credentials only. Browser OAuth is not
          required for this path.
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
              Create a PAT in Snowflake authentication settings. Account URL can be
              the host (for example{" "}
              <span className="font-mono text-xs">
                https://org-account.snowflakecomputing.com
              </span>
              ) or a full Cortex base. See{" "}
              <a
                href="https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Cortex REST API
                <ExternalLinkIcon className="size-3" />
              </a>
              .
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Account URL or identifier</Label>
                <Input
                  value={accountUrl}
                  onChange={(e) => setAccountUrl(e.target.value)}
                  placeholder="https://org-account.snowflakecomputing.com"
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-1">
                  <Label className="text-xs">Programmatic access token</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="…"
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void connect()}
                >
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
              <Label className="text-xs">Model for Intelligence</Label>
              <Select
                value={modelChoice}
                onValueChange={(v) =>
                  setModelChoice(v ?? SNOWFLAKE_CORTEX_CHAT[0].id)
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SNOWFLAKE_CORTEX_CHAT.map((m) => (
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
                <Label className="text-xs">Cortex model id</Label>
                <Input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="claude-sonnet-4-5"
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
                Use Snowflake Cortex for Intelligence
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
