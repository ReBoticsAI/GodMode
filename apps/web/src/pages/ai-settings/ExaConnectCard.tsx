import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, SearchIcon } from "lucide-react";
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
  createAiSecret,
  deleteAiSecret,
  fetchAiSecrets,
  type AiSecret,
} from "@/api";

/** Fixed Vault secret name read by bridge Exa web_search / fetch_url. */
export const EXA_API_KEY_SECRET_NAME = "exa_api_key";

const EXA_SIGNUP_URL = "https://dashboard.exa.ai";
const EXA_BILLING_URL = "https://dashboard.exa.ai/billing";

type ExaStatus = {
  connected: boolean;
  secret: AiSecret | null;
};

function findExaSecrets(secrets: AiSecret[]): AiSecret[] {
  return secrets.filter(
    (s) => s.name.toLowerCase() === EXA_API_KEY_SECRET_NAME
  );
}

/** Connect Exa for agent web search and URL fetch (BYOK secret, no LLM harness). */
export function ExaConnectCard() {
  const [status, setStatus] = useState<ExaStatus>({ connected: false, secret: null });
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { secrets } = await fetchAiSecrets();
      const matches = findExaSecrets(secrets);
      const secret = matches[0] ?? null;
      setStatus({ connected: Boolean(secret), secret });
    } catch {
      setStatus({ connected: false, secret: null });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connect = async () => {
    if (!apiKey.trim()) {
      toast.error("Paste your Exa API key");
      return;
    }
    setBusy(true);
    try {
      const { secrets } = await fetchAiSecrets();
      for (const existing of findExaSecrets(secrets)) {
        await deleteAiSecret(existing.id);
      }
      await createAiSecret(EXA_API_KEY_SECRET_NAME, apiKey.trim());
      setApiKey("");
      await reload();
      toast.success("Exa connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const { secrets } = await fetchAiSecrets();
      for (const existing of findExaSecrets(secrets)) {
        await deleteAiSecret(existing.id);
      }
      await reload();
      toast.success("Exa disconnected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SearchIcon className="size-4" />
          Exa
        </CardTitle>
        <CardDescription>
          Web search and URL fetch for agents. On GodMode Cloud, tools use your Exa key so
          egress goes through Exa instead of the shared host IP. Self-host may fall back to
          DuckDuckGo when no key is set.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.connected ? "default" : "secondary"}>
            {status.connected ? "Connected" : "Not connected"}
          </Badge>
          {status.connected && status.secret?.masked ? (
            <span className="font-mono text-xs text-muted-foreground">
              {status.secret.masked}
            </span>
          ) : null}
        </div>

        {!status.connected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Create a key in the{" "}
              <a
                href={EXA_SIGNUP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Exa dashboard
                <ExternalLinkIcon className="size-3" />
              </a>
              . Manage credits at{" "}
              <a
                href={EXA_BILLING_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Exa billing
                <ExternalLinkIcon className="size-3" />
              </a>
              . Stored as Vault secret{" "}
              <span className="font-mono text-xs">{EXA_API_KEY_SECRET_NAME}</span>.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1">
                <Label className="text-xs">API key</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="exa-…"
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
            <p className="text-sm text-muted-foreground">
              Agents use this key for web_search and fetch_url. Manage credits at{" "}
              <a
                href={EXA_BILLING_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Exa billing
                <ExternalLinkIcon className="size-3" />
              </a>
              .
            </p>
            <div className="flex flex-wrap gap-2">
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
