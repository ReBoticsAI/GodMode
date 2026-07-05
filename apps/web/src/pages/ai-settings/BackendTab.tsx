import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchAiSecrets,
  fetchSharedModels,
  type AgentBackendKind,
  type AiAgent,
  type AiSecret,
  type SharedModel,
} from "@/api";

export function BackendTab({
  agent,
  saveAgent,
}: {
  agent: AiAgent | null;
  saveAgent: (patch: Partial<AiAgent> & Record<string, unknown>) => void;
}) {
  const [secrets, setSecrets] = useState<AiSecret[]>([]);
  const [sharedModels, setSharedModels] = useState<SharedModel[]>([]);

  useEffect(() => {
    fetchAiSecrets()
      .then((r) => setSecrets(r.secrets))
      .catch(() => setSecrets([]));
    fetchSharedModels()
      .then((r) => setSharedModels(r.models))
      .catch(() => setSharedModels([]));
  }, []);

  if (!agent) return <p className="text-xs text-muted-foreground">Select an agent.</p>;

  const cfg = agent.config ?? {};
  const backend = agent.backend;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label className="text-[11px]">Execution backend</Label>
        <Select
          value={backend}
          onValueChange={(v) => saveAgent({ backend: v as AgentBackendKind })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local llama-server</SelectItem>
            <SelectItem value="provider">API provider (OpenAI / Anthropic)</SelectItem>
            <SelectItem value="cli">CLI (Claude Code / OpenCode)</SelectItem>
            <SelectItem value="acp">ACP (Agent Client Protocol)</SelectItem>
            <SelectItem value="remote">Remote inference (marketplace endpoint)</SelectItem>
            <SelectItem value="cursor_cloud">Cursor subscription (Composer, Auto…)</SelectItem>
            <SelectItem value="cursor">Cursor CLI contractor (cursor-agent)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {backend === "remote" && (
        <>
          {sharedModels.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Shared with me (free)</Label>
              <Select
                value={
                  sharedModels.some((m) => m.endpointId === cfg.endpointId)
                    ? String(cfg.endpointId)
                    : ""
                }
                onValueChange={(v) =>
                  saveAgent({ config: { ...cfg, endpointId: v } })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Pick a model a friend shared" />
                </SelectTrigger>
                <SelectContent>
                  {sharedModels.map((m) => (
                    <SelectItem key={m.endpointId} value={m.endpointId}>
                      {m.baseModelName} — from {m.ownerDisplayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Free friend-to-friend inference — no credits charged.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Endpoint ID</Label>
            <Input
              className="h-8 text-xs"
              value={String(cfg.endpointId ?? "")}
              onChange={(e) =>
                saveAgent({ config: { ...cfg, endpointId: e.target.value } })
              }
              placeholder="inference endpoint id"
            />
            <p className="text-[10px] text-muted-foreground">
              A shared (free) endpoint, or a metered marketplace endpoint you have
              access to.
            </p>
          </div>
        </>
      )}

      {backend === "local" && (
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Model path (optional swap)</Label>
          <Input
            className="h-8 font-mono text-xs"
            value={agent.modelPath ?? ""}
            onChange={(e) => saveAgent({ modelPath: e.target.value || null })}
            placeholder="Leave empty to use the global running model"
          />
          <p className="text-[10px] text-amber-600">
            Changing GGUF restarts the local server (slow on 16GB GPU).
          </p>
        </div>
      )}

      {backend === "provider" && (
        <>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Provider</Label>
            <Select
              value={String(cfg.provider ?? "openai")}
              onValueChange={(v) =>
                saveAgent({ config: { ...cfg, provider: v } })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openai_compatible">OpenAI-compatible</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">API key</Label>
            <Select
              value={String(cfg.apiKeyRef ?? "")}
              onValueChange={(v) =>
                saveAgent({ config: { ...cfg, apiKeyRef: v || undefined } })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select secret" />
              </SelectTrigger>
              <SelectContent>
                {secrets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.masked})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Model</Label>
            <Input
              className="h-8 text-xs"
              value={String(cfg.model ?? "")}
              onChange={(e) => saveAgent({ config: { ...cfg, model: e.target.value } })}
              placeholder="gpt-4o / claude-sonnet-4-20250514"
            />
          </div>
          {(cfg.provider === "openai_compatible" || !cfg.provider) && (
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Base URL</Label>
              <Input
                className="h-8 font-mono text-xs"
                value={String(cfg.baseUrl ?? "")}
                onChange={(e) => saveAgent({ config: { ...cfg, baseUrl: e.target.value } })}
                placeholder="https://api.openai.com/v1"
              />
            </div>
          )}
        </>
      )}

      {(backend === "cli" || backend === "acp") && (
        <>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Command</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={String(cfg.command ?? "")}
              onChange={(e) => saveAgent({ config: { ...cfg, command: e.target.value } })}
              placeholder={backend === "cli" ? "claude" : "npx"}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Args (comma-separated)</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={Array.isArray(cfg.args) ? (cfg.args as string[]).join(", ") : ""}
              onChange={(e) =>
                saveAgent({
                  config: {
                    ...cfg,
                    args: e.target.value
                      .split(",")
                      .map((a) => a.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="-p, {{prompt}}"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Working directory</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={String(cfg.cwd ?? "")}
              onChange={(e) => saveAgent({ config: { ...cfg, cwd: e.target.value } })}
            />
          </div>
        </>
      )}

      {backend === "cursor_cloud" && (
        <>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Model</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={String(cfg.model ?? "auto")}
              onChange={(e) => saveAgent({ config: { ...cfg, model: e.target.value } })}
              placeholder="auto"
            />
            <p className="text-[10px] text-muted-foreground">
              Uses your Cursor subscription via <span className="font-mono">@cursor/sdk</span>.
              Connect in Vault → Cursor subscription. Common ids:{" "}
              <span className="font-mono">auto</span>,{" "}
              <span className="font-mono">composer-2.5</span>.
            </p>
          </div>
          <p className="rounded-md border bg-muted/20 p-2 text-[10px] text-muted-foreground">
            GodMode tools (wiki, coding, plugins) run as SDK custom tools — same Intelligence
            experience, Cursor-hosted models. Usage bills to your Cursor account.
          </p>
        </>
      )}

      {backend === "cursor" && (
        <>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Model</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={String(cfg.model ?? "")}
              onChange={(e) => saveAgent({ config: { ...cfg, model: e.target.value } })}
              placeholder="auto"
            />
            <p className="text-[10px] text-muted-foreground">
              Defaults to <span className="font-mono">auto</span>. Specific models
              (e.g. gpt-5.2, sonnet-4) may require available usage on your Cursor
              account.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Mode</Label>
            <Select
              value={String(cfg.mode ?? "agent")}
              onValueChange={(v) =>
                saveAgent({
                  config: { ...cfg, mode: v === "agent" ? undefined : v },
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">Agent (read/write/run)</SelectItem>
                <SelectItem value="plan">Plan (read-only)</SelectItem>
                <SelectItem value="ask">Ask (read-only Q&amp;A)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Isolation</Label>
            <Select
              value={cfg.worktree === false ? "live" : "worktree"}
              onValueChange={(v) =>
                saveAgent({ config: { ...cfg, worktree: v === "worktree" } })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="worktree">Isolated git worktree (safe)</SelectItem>
                <SelectItem value="live">Live working tree</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Worktree runs the agent in a throwaway branch under
              <span className="font-mono"> ~/.cursor/worktrees</span> so your live
              files are never touched.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Workspace directory</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={String(cfg.workspace ?? "")}
              onChange={(e) =>
                saveAgent({ config: { ...cfg, workspace: e.target.value } })
              }
              placeholder="(defaults to bridge working directory)"
            />
          </div>
          <p className="rounded-md border bg-muted/20 p-2 text-[10px] text-muted-foreground">
            Requires the Cursor CLI installed and authenticated on the bridge
            machine (<span className="font-mono">cursor-agent login</span> or{" "}
            <span className="font-mono">CURSOR_API_KEY</span>).
          </p>
        </>
      )}

      <div className="rounded-md border bg-muted/20 p-2">
        <Label className="text-[11px]">API secrets (platform-wide)</Label>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Shared keys for provider backends. Manage in{" "}
          <Link to="/settings" className="text-primary underline-offset-2 hover:underline">
            Settings → AI platform secrets
          </Link>
          .
        </p>
        {secrets.length > 0 && (
          <ul className="mt-2 space-y-1 text-[10px] text-muted-foreground">
            {secrets.map((s) => (
              <li key={s.id}>
                {s.name} <span className="font-mono">{s.masked}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
