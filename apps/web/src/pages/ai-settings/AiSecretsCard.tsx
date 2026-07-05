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
} from "@/api";

/** Platform-wide API secrets (shared across all agents). */
export function AiSecretsCard() {
  const [secrets, setSecrets] = useState<AiSecret[]>([]);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");

  const reload = () => {
    fetchAiSecrets()
      .then((r) => setSecrets(r.secrets))
      .catch(() => setSecrets([]));
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4" />
          AI platform secrets
        </CardTitle>
        <CardDescription>
          Shared API keys for provider backends. Referenced by agents in Agents → Pipeline →
          Backend; not scoped to individual subagents.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {secrets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No secrets stored yet.</p>
        ) : (
          <ul className="space-y-2">
            {secrets.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {s.name}{" "}
                  <span className="font-mono text-xs text-muted-foreground">{s.masked}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-xs text-destructive"
                  onClick={() => void deleteAiSecret(s.id).then(reload)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={secretName}
              onChange={(e) => setSecretName(e.target.value)}
              placeholder="openai-prod"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label className="text-xs">Secret value</Label>
            <Input
              type="password"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="sk-…"
            />
          </div>
          <Button
            type="button"
            className="shrink-0"
            disabled={!secretName.trim() || !secretValue.trim()}
            onClick={() => {
              void createAiSecret(secretName.trim(), secretValue.trim()).then(() => {
                setSecretName("");
                setSecretValue("");
                reload();
              });
            }}
          >
            Add secret
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
