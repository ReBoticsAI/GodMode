import { useEffect, useState } from "react";
import { KeyRoundIcon } from "lucide-react";
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
  createAiSecret,
  deleteAiSecret,
  fetchAiSecrets,
  type AiSecret,
  type VaultScope,
} from "@/api";

/** Free-form secrets for one Vault owner (platform, user, or agent). */
export function AiSecretsCard({
  vaultScope = { ownerKind: "platform" },
  /** @deprecated Use vaultScope instead. String agent id → agent Vault. */
  vaultAgentId,
}: {
  vaultScope?: VaultScope;
  vaultAgentId?: string | null;
}) {
  const scope: VaultScope =
    vaultAgentId != null && vaultAgentId !== ""
      ? { ownerKind: "agent", agentId: vaultAgentId }
      : vaultScope;

  const [secrets, setSecrets] = useState<AiSecret[]>([]);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");

  const reload = () => {
    fetchAiSecrets(scope)
      .then((r) => setSecrets(r.secrets))
      .catch(() => setSecrets([]));
  };

  useEffect(() => {
    reload();
  }, [scope.ownerKind, scope.agentId]);

  const scopeLabel =
    scope.ownerKind === "agent"
      ? "this Agent Vault"
      : scope.ownerKind === "user"
        ? "your Personal Vault"
        : "the User Vault";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4" />
          Secrets
        </CardTitle>
        <CardDescription>
          Free-form secrets for {scopeLabel}. Prefer named Connect cards when one
          exists.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {secrets.length === 0 ? (
            <li className="text-sm text-muted-foreground">No secrets yet.</li>
          ) : (
            secrets.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {s.masked}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void deleteAiSecret(s.id, scope).then(reload);
                  }}
                >
                  Delete
                </Button>
              </li>
            ))
          )}
        </ul>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!secretName.trim() || !secretValue) return;
            void createAiSecret(secretName.trim(), secretValue, scope).then(
              () => {
                setSecretName("");
                setSecretValue("");
                reload();
              }
            );
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="secret-name">Name</Label>
            <Input
              id="secret-name"
              value={secretName}
              onChange={(e) => setSecretName(e.target.value)}
              placeholder="my_api_key"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="secret-value">Value</Label>
            <Input
              id="secret-value"
              type="password"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" disabled={!secretName.trim() || !secretValue}>
            Add secret
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
