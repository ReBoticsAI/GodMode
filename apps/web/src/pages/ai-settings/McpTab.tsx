import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  fetchAiMcp,
  type AiAgent,
  type AiMcpStatus,
} from "@/api";
import { platformVaultSettingsHref } from "@/lib/navigation";

export function McpTab({
  agent,
  saveAgent,
}: {
  agent: AiAgent | null;
  saveAgent: (patch: Partial<AiAgent> & Record<string, unknown>) => void;
}) {
  const [status, setStatus] = useState<AiMcpStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!agent) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      setStatus(await fetchAiMcp(agent.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load MCP");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!agent) {
    return <p className="text-xs text-muted-foreground">Select an agent.</p>;
  }

  const cfg = agent.config ?? {};
  const isCursorCloud = agent.backend === "cursor_cloud";
  const mcpFromWorkspace =
    typeof cfg.mcpFromWorkspace === "boolean"
      ? Boolean(cfg.mcpFromWorkspace)
      : true;
  const disabled = Array.isArray(cfg.mcpDisabledServers)
    ? (cfg.mcpDisabledServers as string[]).filter((n) => typeof n === "string")
    : [];

  const setServerEnabled = (name: string, enabled: boolean) => {
    const next = enabled
      ? disabled.filter((n) => n !== name)
      : disabled.includes(name)
        ? disabled
        : [...disabled, name];
    saveAgent({ config: { ...cfg, mcpDisabledServers: next } });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">
            Servers discovered from coding-root{" "}
            <span className="font-mono">.cursor/mcp.json</span>. Manage pass-through
            here; GodMode Automations Hooks are unrelated. Tenant-owned MCP CRUD
            (without a disk file) is planned next.
          </p>
          {status?.sourcePath && (
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              {status.sourcePath}
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 gap-1 text-xs"
          disabled={loading}
          onClick={() => void reload()}
        >
          <RefreshCwIcon className="size-3" />
          Refresh
        </Button>
      </div>

      {isCursorCloud ? (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <Label className="text-[11px]">Pass workspace MCP to SDK</Label>
            <p className="text-[10px] text-muted-foreground">
              Inline <span className="font-mono">mcpServers</span> (cap 8). Default on
              for local installs; off on SaaS unless enabled. Ambient project MCP may
              still load via SDK settingSources.
            </p>
          </div>
          <Switch
            checked={mcpFromWorkspace}
            onCheckedChange={(v) =>
              saveAgent({ config: { ...cfg, mcpFromWorkspace: v } })
            }
          />
        </div>
      ) : (
        <p className="rounded-md border bg-muted/20 p-2 text-[10px] text-muted-foreground">
          This backend uses MCP discovery in the prompt only. Switch the agent to{" "}
          <span className="font-medium">Cursor subscription</span> to pass servers to
          the SDK. Connect in{" "}
          <Link
            to={platformVaultSettingsHref("subscriptions")}
            className="text-primary underline-offset-2 hover:underline"
          >
            User Vault → Inference → Subscriptions
          </Link>
          .
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px]">Servers</Label>
        {!status?.servers.length ? (
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Loading…"
              : "No servers found. Add them under coding-root .cursor/mcp.json, or set Backend → Coding workspace."}
          </p>
        ) : (
          status.servers.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-xs font-medium">{s.name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {s.transport}
                  </Badge>
                </div>
                {s.detail && (
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {s.detail}
                  </span>
                )}
              </div>
              <Switch
                checked={
                  !disabled.includes(s.name) &&
                  (isCursorCloud ? mcpFromWorkspace : true)
                }
                disabled={!isCursorCloud || !mcpFromWorkspace}
                onCheckedChange={(v) => setServerEnabled(s.name, v)}
              />
            </div>
          ))
        )}
      </div>

      {status?.projectInstructions && (
        <p className="text-[10px] text-muted-foreground">
          Project instructions:{" "}
          <span className="font-medium">
            {status.projectInstructions === "sdk"
              ? "SDK settingSources"
              : status.projectInstructions === "knowledge"
                ? "Knowledge Rules / Skills"
                : "none"}
          </span>
        </p>
      )}
    </div>
  );
}
