import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  fetchAiMcp,
  importAiMcpServers,
  putAiMcpServers,
  type AiAgent,
  type AiMcpStatus,
} from "@/api";
import { platformVaultSettingsHref } from "@/lib/navigation";

function executionLabel(execution: string | undefined): string {
  switch (execution) {
    case "sdk-inline":
      return "Callable (SDK inline)";
    case "sdk-project":
      return "Callable (SDK project settings)";
    case "bridge-host":
      return "Callable (Bridge host)";
    case "discovery-only":
    default:
      return "Discovery only";
  }
}

function kvToLines(record: unknown): string {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "";
  return Object.entries(record as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string" && v !== "***")
    .map(([k, v]) => `${k}=${v as string}`)
    .join("\n");
}

function linesToKv(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && value && value !== "***") out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

type TransportKind = "stdio" | "http";

function McpServerDialog({
  open,
  onOpenChange,
  initialName,
  initial,
  existingNames,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  initial?: Record<string, unknown> | null;
  existingNames: string[];
  onSave: (name: string, cfg: Record<string, unknown>) => Promise<void>;
}) {
  const editing = Boolean(initialName);
  const [name, setName] = useState(initialName ?? "");
  const [transport, setTransport] = useState<TransportKind>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [envText, setEnvText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName ?? "");
    const type =
      typeof initial?.type === "string" ? initial.type : undefined;
    const nextTransport: TransportKind =
      type === "http" || type === "sse" || typeof initial?.url === "string"
        ? "http"
        : "stdio";
    setTransport(nextTransport);
    setCommand(typeof initial?.command === "string" ? initial.command : "");
    setArgs(
      Array.isArray(initial?.args)
        ? initial.args.filter((a): a is string => typeof a === "string").join(" ")
        : ""
    );
    setUrl(typeof initial?.url === "string" ? initial.url : "");
    setEnvText(kvToLines(initial?.env));
    setHeadersText(kvToLines(initial?.headers));
  }, [open, initialName, initial]);

  const submit = async () => {
    const id = name.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,62}$/.test(id) || id.includes("__")) {
      toast.error("Name must be letters, numbers, dot, underscore, or hyphen.");
      return;
    }
    if (!editing && existingNames.includes(id)) {
      toast.error("A server with that name already exists.");
      return;
    }
    let cfg: Record<string, unknown>;
    if (transport === "stdio") {
      if (!command.trim()) {
        toast.error("Command is required.");
        return;
      }
      const argList = args.trim() ? args.trim().split(/\s+/) : undefined;
      cfg = {
        type: "stdio",
        command: command.trim(),
        ...(argList?.length ? { args: argList } : {}),
        ...(linesToKv(envText) ? { env: linesToKv(envText) } : {}),
      };
    } else {
      if (!url.trim()) {
        toast.error("URL is required.");
        return;
      }
      cfg = {
        type: "http",
        url: url.trim(),
        ...(linesToKv(headersText) ? { headers: linesToKv(headersText) } : {}),
      };
    }
    setBusy(true);
    try {
      await onSave(id, cfg);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save MCP server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
          <DialogDescription>
            Stored in this workspace. Use vault:secret_name for env or headers.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
            <Input
              id="mcp-name"
              value={name}
              disabled={editing}
              onChange={(e) => setName(e.target.value)}
              placeholder="github"
            />
          </Field>
          <Field>
            <FieldLabel>Transport</FieldLabel>
            <ToggleGroup
              value={[transport]}
              onValueChange={(next) => {
                const value = Array.isArray(next) ? next[0] : next;
                if (value === "stdio" || value === "http") setTransport(value);
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="stdio">stdio</ToggleGroupItem>
              <ToggleGroupItem value="http">HTTP</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          {transport === "stdio" ? (
            <>
              <Field>
                <FieldLabel htmlFor="mcp-command">Command</FieldLabel>
                <Input
                  id="mcp-command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-args">Args</FieldLabel>
                <Input
                  id="mcp-args"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-github"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-env">Env</FieldLabel>
                <Textarea
                  id="mcp-env"
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder={"GITHUB_TOKEN=vault:github_token"}
                  rows={3}
                />
                <FieldDescription>
                  One KEY=value per line. Leave empty to keep a stored secret.
                </FieldDescription>
              </Field>
            </>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="mcp-url">URL</FieldLabel>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.example.com/sse"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-headers">Headers</FieldLabel>
                <Textarea
                  id="mcp-headers"
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder={"Authorization=vault:mcp_token"}
                  rows={3}
                />
              </Field>
            </>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function McpTab({
  agent,
  saveAgent,
}: {
  agent: AiAgent | null;
  saveAgent: (patch: Partial<AiAgent> & Record<string, unknown>) => void;
}) {
  const [status, setStatus] = useState<AiMcpStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);

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
      : status != null
        ? Boolean(status.mcpFromWorkspace)
        : false;
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

  const currentMap = (): Record<string, unknown> => {
    const defs = status?.definitions ?? {};
    if (status?.workspaceConfigured) return { ...defs };
    const fromList: Record<string, unknown> = {};
    for (const s of status?.servers ?? []) {
      fromList[s.name] = defs[s.name] ?? { type: s.transport };
    }
    return fromList;
  };

  const saveMap = async (next: Record<string, unknown>) => {
    await putAiMcpServers(next, agent.id);
    await reload();
  };

  const hostLabel = isCursorCloud
    ? "Pass workspace MCP"
    : "Host workspace MCP in Bridge";
  const hostHelp = isCursorCloud ? (
    <>
      Cap 8 servers from this workspace. On sandboxed SaaS, Bridge hosts them as
      callable tools. Local installs may use SDK inline mcpServers. Default on
      for local installs; off on SaaS unless enabled.
    </>
  ) : (
    <>
      Bridge connects stdio and HTTP/SSE servers from this workspace (cap 8).
      Default on for local installs; off on SaaS unless enabled. Use{" "}
      <span className="font-mono">vault:secret_name</span> in env or headers.
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">
            MCP servers are a GodMode workspace setting. Coding-root{" "}
            <span className="font-mono">.godmode/mcp.json</span> or{" "}
            <span className="font-mono">.cursor/mcp.json</span> can be imported
            once. Manage host here; Automations Hooks are unrelated.
          </p>
          {status?.sourcePath && (
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              {status.sourcePath}
            </p>
          )}
          {status && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge
                variant={
                  status.execution === "discovery-only" || !status.execution
                    ? "secondary"
                    : "outline"
                }
              >
                {executionLabel(status.execution)}
              </Badge>
              {status.sourceKind === "workspace" && (
                <Badge variant="outline">Workspace</Badge>
              )}
              {status.sourceKind === "godmode" && (
                <Badge variant="outline">File</Badge>
              )}
              {status.sourceKind === "cursor" && (
                <Badge variant="secondary">Cursor compatibility</Badge>
              )}
              {status.execution === "discovery-only" &&
                (status.servers?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400">
                    Listed in Pipeline only. Enable the switch below to call
                    tools from Intelligence chat.
                  </span>
                )}
            </div>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void reload()}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <Label>{hostLabel}</Label>
          <p className="text-xs text-muted-foreground">{hostHelp}</p>
          {!isCursorCloud && (
            <p className="text-xs text-muted-foreground">
              Prefer Cursor subscription for SDK-native MCP? Connect in{" "}
              <Link
                to={platformVaultSettingsHref("subscriptions")}
                className="text-primary underline-offset-2 hover:underline"
              >
                Platform Vault → Inference → Subscriptions
              </Link>
              .
            </p>
          )}
        </div>
        <Switch
          checked={mcpFromWorkspace}
          onCheckedChange={(v) =>
            saveAgent({ config: { ...cfg, mcpFromWorkspace: v } })
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Label>Servers</Label>
        <div className="flex flex-wrap gap-2">
          {status?.fileImportAvailable && !status.workspaceConfigured && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void (async () => {
                  try {
                    await importAiMcpServers(agent.id);
                    toast.success("Imported coding-root MCP file");
                    await reload();
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "Import failed"
                    );
                  }
                })();
              }}
            >
              Import file
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditName(null);
              setDialogOpen(true);
            }}
          >
            <PlusIcon data-icon="inline-start" />
            Add
          </Button>
        </div>
      </div>

      {!status?.servers.length ? (
        loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>No MCP servers</EmptyTitle>
              <EmptyDescription>
                Add a server for this workspace, or import a coding-root JSON
                file.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent />
          </Empty>
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          {status.servers.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-xs font-medium">{s.name}</span>
                  <Badge variant="secondary">{s.transport}</Badge>
                  {s.hostOk === true && (
                    <Badge variant="outline">
                      host ok
                      {typeof s.hostToolCount === "number"
                        ? ` (${s.hostToolCount})`
                        : ""}
                    </Badge>
                  )}
                  {s.hostOk === false && (
                    <Badge variant="destructive">host error</Badge>
                  )}
                </div>
                {s.detail && (
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {s.detail}
                  </span>
                )}
                {s.hostError && (
                  <span className="truncate text-[10px] text-destructive">
                    {s.hostError}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditName(s.name);
                    setDialogOpen(true);
                  }}
                >
                  <PencilIcon data-icon="inline-start" />
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void (async () => {
                      const next = currentMap();
                      delete next[s.name];
                      try {
                        await saveMap(next);
                        toast.success(`Removed ${s.name}`);
                      } catch (e) {
                        toast.error(
                          e instanceof Error ? e.message : "Remove failed"
                        );
                      }
                    })();
                  }}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Remove
                </Button>
                <Switch
                  checked={!disabled.includes(s.name) && mcpFromWorkspace}
                  disabled={!mcpFromWorkspace}
                  onCheckedChange={(v) => setServerEnabled(s.name, v)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {status?.projectInstructions && (
        <p className="text-xs text-muted-foreground">
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

      <McpServerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialName={editName ?? undefined}
        initial={
          editName && status?.definitions?.[editName]
            ? status.definitions[editName]
            : null
        }
        existingNames={(status?.servers ?? []).map((s) => s.name)}
        onSave={async (name, cfg) => {
          const next = currentMap();
          next[name] = cfg;
          await saveMap(next);
          toast.success(editName ? "Server updated" : "Server added");
        }}
      />
    </div>
  );
}
