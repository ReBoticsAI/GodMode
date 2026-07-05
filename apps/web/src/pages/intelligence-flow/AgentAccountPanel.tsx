import { useCallback, useEffect, useState } from "react";
import {
  createAgentApiKeyAccount,
  fetchAgentAccounts,
  revokeAgentAccount,
  type AiAgentAccount,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function AgentAccountPanel({ agentId }: { agentId: string }) {
  const [accounts, setAccounts] = useState<AiAgentAccount[]>([]);
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchAgentAccounts(agentId)
      .then((r) => setAccounts(r.accounts))
      .catch(() => setAccounts([]));
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const addApiKey = async () => {
    if (!provider.trim() || !apiKey.trim()) return;
    setBusy(true);
    try {
      await createAgentApiKeyAccount(agentId, {
        provider: provider.trim(),
        apiKey: apiKey.trim(),
        label: label.trim() || undefined,
      });
      setApiKey("");
      load();
      toast.success("API key linked to agent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add key");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (accountId: string) => {
    try {
      await revokeAgentAccount(agentId, accountId);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Per-agent API keys used before tenant-wide Vault secrets. Add provider
        keys here so this agent can call external LLM or tool APIs.
      </p>

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium">Linked credentials</Label>
        {accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No credentials linked yet.</p>
        ) : (
          accounts.map((a) => (
            <div
              key={a.id}
              className="flex items-start justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {a.kind}
                  </Badge>
                  {a.provider && (
                    <Badge variant="secondary" className="text-[10px]">
                      {a.provider}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 truncate text-xs">
                  {a.displayName || a.email || a.providerUserId || a.id}
                </div>
                {a.maskedToken && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {a.maskedToken}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => void revoke(a.id)}
              >
                Remove
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <Label className="text-xs font-medium">Add API key</Label>
        <Input
          className="h-8 text-xs"
          placeholder="Provider (openai, anthropic, …)"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        />
        <Input
          className="h-8 text-xs"
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          className="h-8 text-xs"
          type="password"
          placeholder="sk-…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || !provider.trim() || !apiKey.trim()}
          onClick={() => void addApiKey()}
        >
          Add API key
        </Button>
      </div>
    </div>
  );
}
