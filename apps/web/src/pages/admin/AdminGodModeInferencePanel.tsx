import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import {
  fetchGodModeInferenceConfig,
  updateGodModeInferenceConfig,
  fetchAdminGodModeInferenceHealth,
  type GodModeInferenceConfig,
  type GodModeInferenceProviderStatus,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const SIGNUP_LINKS = [
  {
    name: "DeepSeek",
    href: "https://platform.deepseek.com/",
    note: "Platform account + API key",
  },
  {
    name: "Z.AI",
    href: "https://z.ai/",
    note: "Payg and/or Coding Plan subscription key",
  },
  {
    name: "Qwen / DashScope",
    href: "https://modelstudio.console.alibabacloud.com/",
    note: "Alibaba Cloud Model Studio API key",
  },
] as const;

function StatusBadge({ status }: { status: GodModeInferenceProviderStatus }) {
  return (
    <Badge variant={status.connected ? "default" : "secondary"}>
      {status.connected
        ? status.source === "env"
          ? "Connected (env)"
          : "Connected"
        : "Not connected"}
    </Badge>
  );
}

function ProviderKeyCard({
  title,
  description,
  status,
  inputId,
  value,
  onChange,
  placeholder,
  onSave,
  onClear,
  busy,
}: {
  title: string;
  description: string;
  status: GodModeInferenceProviderStatus;
  inputId: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onSave: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <StatusBadge status={status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status.connected && status.masked ? (
          <p className="font-mono text-xs text-muted-foreground">{status.masked}</p>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId}>API key</Label>
          <Input
            id={inputId}
            type="password"
            autoComplete="off"
            placeholder={
              status.connected ? "•••••••• (leave blank to keep)" : placeholder
            }
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void onSave()}
            disabled={busy || !value.trim()}
          >
            {busy ? <Spinner className="size-4" /> : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onClear()}
            disabled={busy || !status.connected || status.source === "env"}
          >
            Disconnect
          </Button>
        </div>
        {status.source === "env" ? (
          <p className="text-xs text-muted-foreground">
            Connected via process environment. Clear the env var to disconnect,
            or save a platform key here to prefer Admin supply.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Admin → GodMode Inference: platform-wide DeepSeek / Z.AI / Qwen supply for
 * new-user signup-guide Intelligence (not personal Platform Vault BYOK).
 */
export function AdminGodModeInferencePanel() {
  const [cfg, setCfg] = useState<GodModeInferenceConfig | null>(null);
  const [health, setHealth] = useState<{
    activeGrants: number;
    totalSpentUsd: number;
    totalBudgetUsd: number;
    supplyReady: boolean;
    plansConfigured: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deepseekKey, setDeepseekKey] = useState("");
  const [zaiKey, setZaiKey] = useState("");
  const [zaiCodingKey, setZaiCodingKey] = useState("");
  const [dashscopeKey, setDashscopeKey] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchGodModeInferenceConfig(),
      fetchAdminGodModeInferenceHealth().catch(() => null),
    ])
      .then(([config, h]) => {
        setCfg(config);
        setHealth(h);
      })
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load GodMode Inference"
        )
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = async (patch: {
    deepseekApiKey?: string;
    zaiApiKey?: string;
    zaiCodingApiKey?: string;
    dashscopeApiKey?: string;
  }) => {
    setBusy(true);
    try {
      const updated = await updateGodModeInferenceConfig(patch);
      setCfg(updated);
      if (patch.deepseekApiKey !== undefined) setDeepseekKey("");
      if (patch.zaiApiKey !== undefined) setZaiKey("");
      if (patch.zaiCodingApiKey !== undefined) setZaiCodingKey("");
      if (patch.dashscopeApiKey !== undefined) setDashscopeKey("");
      toast.success("GodMode Inference supply updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !cfg) {
    return (
      <p className="text-sm text-muted-foreground">
        {loading ? "Loading…" : "Unable to load GodMode Inference config."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon className="size-5" />
            GodMode Inference
          </CardTitle>
          <CardDescription>
            Platform supply keys for managed GodMode Inference chat only
            (Intelligence welcome guide and paid packs/subscriptions). Encrypted
            in the platform database. Never appears as a user Vault connection.
            Never powers other agents or Advanced BYOK. Not a vendor partnership
            claim.
          </CardDescription>
          <CardAction>
            <Badge variant={cfg.configured ? "default" : "secondary"}>
              {cfg.configured ? "Supply ready" : "Not configured"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Sign up with each provider under the operator account, then paste keys
            below. New users get GodMode Inference without entering their own keys
            first. Spend is limited to Intelligence with an active grant.
          </p>
          <ul className="flex flex-col gap-2">
            {SIGNUP_LINKS.map((link) => (
              <li
                key={link.name}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
              >
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                >
                  {link.name}
                  <ExternalLinkIcon className="size-3" />
                </a>
                <span className="text-muted-foreground">{link.note}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {health ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Grant health</CardTitle>
            <CardDescription>
              Active managed allowances across this instance.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span>{health.activeGrants} active grants</span>
            <span>${health.totalSpentUsd.toFixed(2)} spent</span>
            <span>${health.totalBudgetUsd.toFixed(2)} budgeted</span>
            <span>{health.plansConfigured} catalog plans</span>
          </CardContent>
        </Card>
      ) : null}

      <ProviderKeyCard
        title="DeepSeek"
        description="Metered DeepSeek platform API key for managed GodMode Inference only."
        status={cfg.deepseek}
        inputId="admin-deepseek-key"
        value={deepseekKey}
        onChange={setDeepseekKey}
        placeholder="sk-…"
        busy={busy}
        onSave={() => void save({ deepseekApiKey: deepseekKey.trim() })}
        onClear={() => void save({ deepseekApiKey: "" })}
      />

      <ProviderKeyCard
        title="Z.AI (GLM payg)"
        description="Metered Z.AI Platform payg key (not Coding Plan)."
        status={cfg.zai}
        inputId="admin-zai-key"
        value={zaiKey}
        onChange={setZaiKey}
        placeholder="…"
        busy={busy}
        onSave={() => void save({ zaiApiKey: zaiKey.trim() })}
        onClear={() => void save({ zaiApiKey: "" })}
      />

      <ProviderKeyCard
        title="Z.AI Coding Plan"
        description="Optional GLM Coding Plan subscription key for platform supply."
        status={cfg.zaiCoding}
        inputId="admin-zai-coding-key"
        value={zaiCodingKey}
        onChange={setZaiCodingKey}
        placeholder="…"
        busy={busy}
        onSave={() => void save({ zaiCodingApiKey: zaiCodingKey.trim() })}
        onClear={() => void save({ zaiCodingApiKey: "" })}
      />

      <ProviderKeyCard
        title="Qwen / DashScope"
        description="Alibaba Cloud Model Studio (DashScope) API key for Qwen."
        status={cfg.dashscope}
        inputId="admin-dashscope-key"
        value={dashscopeKey}
        onChange={setDashscopeKey}
        placeholder="sk-…"
        busy={busy}
        onSave={() => void save({ dashscopeApiKey: dashscopeKey.trim() })}
        onClear={() => void save({ dashscopeApiKey: "" })}
      />
    </div>
  );
}
