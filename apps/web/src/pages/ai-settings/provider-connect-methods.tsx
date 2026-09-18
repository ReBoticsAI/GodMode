import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { KeyRoundIcon, SparklesIcon } from "lucide-react";

/** Real connect methods GodMode can offer for inference today. */
export type ConnectMethodId =
  | "api-key"
  | "subscription-key"
  | "sdk"
  | "pat"
  | "oauth";

export type ConnectMethodStatus = "available" | "planned" | "unavailable";

export type VaultInferenceBucket =
  | "subscriptions"
  | "api-keys"
  | "optimized"
  | "search";

export type InferenceProviderId =
  | "cursor"
  | "zai-coding"
  | "opencode-go"
  | "opencode-zen"
  | "digitalocean"
  | "snowflake"
  | "minimax-token"
  | "kimi-code"
  | "poe"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "groq"
  | "together"
  | "fireworks"
  | "deepseek"
  | "dashscope"
  | "google-ai"
  | "xai"
  | "zai-payg"
  | "minimax-payg"
  | "custom-openai"
  | "exa"
  | "github-copilot"
  | "gitlab-duo"
  | "xai-supergrok";

export interface ProviderConnectMethod {
  id: ConnectMethodId;
  label: string;
  status: ConnectMethodStatus;
  /** Short honest note shown in the overview matrix. */
  note?: string;
}

export interface ProviderConnectEntry {
  id: InferenceProviderId;
  name: string;
  bucket: VaultInferenceBucket;
  /** True when a Vault Connect card ships today. */
  cardShipped: boolean;
  methods: ProviderConnectMethod[];
}

const METHOD_LABEL: Record<ConnectMethodId, string> = {
  "api-key": "API key",
  "subscription-key": "Subscription key",
  sdk: "SDK",
  pat: "PAT",
  oauth: "OAuth",
};

/**
 * Provider × connect-method matrix. Only `available` methods should appear as
 * live Connect UI. Planned / unavailable stay overview-only (no fake buttons).
 */
export const PROVIDER_CONNECT_MATRIX: ProviderConnectEntry[] = [
  {
    id: "cursor",
    name: "Cursor",
    bucket: "subscriptions",
    cardShipped: true,
    methods: [
      {
        id: "api-key",
        label: "User API key",
        status: "available",
        note: "Dashboard → Integrations. Powers Intelligence Auto via @cursor/sdk.",
      },
      {
        id: "sdk",
        label: "Cursor SDK",
        status: "available",
        note: "Same User API key. No separate SDK login in GodMode.",
      },
      {
        id: "oauth",
        label: "OAuth",
        status: "unavailable",
        note: "Cursor does not offer third-party OAuth that yields a billing key.",
      },
    ],
  },
  {
    id: "zai-coding",
    name: "Z.AI GLM Coding Plan",
    bucket: "subscriptions",
    cardShipped: true,
    methods: [
      {
        id: "subscription-key",
        label: "Subscription key",
        status: "available",
      },
    ],
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    bucket: "subscriptions",
    cardShipped: true,
    methods: [
      {
        id: "subscription-key",
        label: "Subscription key",
        status: "available",
      },
    ],
  },
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    bucket: "subscriptions",
    cardShipped: true,
    methods: [
      {
        id: "subscription-key",
        label: "API / plan key",
        status: "available",
      },
    ],
  },
  {
    id: "digitalocean",
    name: "DigitalOcean Inference",
    bucket: "subscriptions",
    cardShipped: true,
    methods: [
      {
        id: "api-key",
        label: "Model access key",
        status: "available",
        note: "Account OAuth not required.",
      },
    ],
  },
  {
    id: "snowflake",
    name: "Snowflake Cortex",
    bucket: "subscriptions",
    cardShipped: true,
    methods: [
      {
        id: "pat",
        label: "PAT + account URL",
        status: "available",
      },
      {
        id: "oauth",
        label: "Browser OAuth",
        status: "planned",
        note: "Deferred. PAT path ships today.",
      },
    ],
  },
  {
    id: "minimax-token",
    name: "MiniMax Token Plan",
    bucket: "subscriptions",
    cardShipped: true,
    methods: [
      {
        id: "subscription-key",
        label: "Subscription key",
        status: "available",
      },
    ],
  },
  {
    id: "kimi-code",
    name: "Kimi Code",
    bucket: "subscriptions",
    cardShipped: true,
    methods: [
      {
        id: "subscription-key",
        label: "Code Console key",
        status: "available",
      },
    ],
  },
  {
    id: "poe",
    name: "Poe",
    bucket: "subscriptions",
    cardShipped: true,
    methods: [
      {
        id: "subscription-key",
        label: "API key (points)",
        status: "available",
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI Platform",
    bucket: "api-keys",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "anthropic",
    name: "Anthropic Console",
    bucket: "api-keys",
    cardShipped: true,
    methods: [
      {
        id: "api-key",
        label: "Console API key",
        status: "available",
        note: "Not Claude.ai consumer login.",
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    bucket: "api-keys",
    cardShipped: true,
    methods: [
      {
        id: "api-key",
        label: "API key",
        status: "available",
        note: "Advanced BYOK. Personal OpenRouter OAuth is not a GodMode Connect card.",
      },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    bucket: "api-keys",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "together",
    name: "Together",
    bucket: "api-keys",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "fireworks",
    name: "Fireworks",
    bucket: "api-keys",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    bucket: "api-keys",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "dashscope",
    name: "Qwen (DashScope)",
    bucket: "api-keys",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "google-ai",
    name: "Google AI Studio",
    bucket: "api-keys",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "xai",
    name: "xAI Console",
    bucket: "api-keys",
    cardShipped: true,
    methods: [
      {
        id: "api-key",
        label: "API key",
        status: "available",
        note: "Metered console key. SuperGrok / X Premium OAuth is separate and not shipped.",
      },
    ],
  },
  {
    id: "zai-payg",
    name: "Z.AI Platform (payg)",
    bucket: "api-keys",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "minimax-payg",
    name: "MiniMax (payg)",
    bucket: "api-keys",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "custom-openai",
    name: "Custom OpenAI-compatible",
    bucket: "api-keys",
    cardShipped: true,
    methods: [
      {
        id: "api-key",
        label: "API key + base URL",
        status: "available",
      },
    ],
  },
  {
    id: "exa",
    name: "Exa",
    bucket: "search",
    cardShipped: true,
    methods: [{ id: "api-key", label: "API key", status: "available" }],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    bucket: "subscriptions",
    cardShipped: false,
    methods: [
      {
        id: "oauth",
        label: "Device code / product auth",
        status: "planned",
        note: "#355 residual after #364 foundation.",
      },
    ],
  },
  {
    id: "gitlab-duo",
    name: "GitLab Duo",
    bucket: "subscriptions",
    cardShipped: false,
    methods: [
      {
        id: "oauth",
        label: "OAuth",
        status: "planned",
        note: "#355 residual. Operator-registered GitLab OAuth app required.",
      },
    ],
  },
  {
    id: "xai-supergrok",
    name: "xAI SuperGrok / X Premium",
    bucket: "subscriptions",
    cardShipped: false,
    methods: [
      {
        id: "oauth",
        label: "OAuth",
        status: "planned",
        note: "#355 residual. Distinct from xAI console API key card.",
      },
    ],
  },
];

export function getProviderConnectEntry(
  id: InferenceProviderId
): ProviderConnectEntry | undefined {
  return PROVIDER_CONNECT_MATRIX.find((p) => p.id === id);
}

/** Methods that may appear as live Connect UI on a shipped card. */
export function getAvailableConnectMethods(
  id: InferenceProviderId
): ProviderConnectMethod[] {
  const entry = getProviderConnectEntry(id);
  if (!entry) return [];
  return entry.methods.filter((m) => m.status === "available");
}

export function ProviderConnectMethodBadges({
  providerId,
}: {
  providerId: InferenceProviderId;
}) {
  const methods = getAvailableConnectMethods(providerId);
  if (methods.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-slot="provider-connect-methods">
      {methods.map((m) => (
        <Badge key={m.id} variant="outline" className="text-[10px] font-normal">
          {m.label}
        </Badge>
      ))}
    </div>
  );
}

function MethodStatusBadge({ status }: { status: ConnectMethodStatus }) {
  if (status === "available") {
    return (
      <Badge variant="default" className="text-[10px]">
        Available
      </Badge>
    );
  }
  if (status === "planned") {
    return (
      <Badge variant="secondary" className="text-[10px]">
        Planned
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      Unavailable
    </Badge>
  );
}

/** Top-of-Inference overview: multi-provider connect modes, honest gaps. */
export function InferenceConnectOverview({
  bucket,
}: {
  bucket: VaultInferenceBucket;
}) {
  const shipped = PROVIDER_CONNECT_MATRIX.filter(
    (p) => p.cardShipped && p.bucket === bucket
  );
  const gaps = PROVIDER_CONNECT_MATRIX.filter(
    (p) =>
      (!p.cardShipped && p.bucket === bucket) ||
      (p.bucket === bucket &&
        p.methods.some((m) => m.status === "planned" || m.status === "unavailable"))
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <SparklesIcon className="size-4" />
          Connect methods
        </CardTitle>
        <CardDescription>
          GodMode Inference supports the connect modes each provider actually offers
          today. Paste a key where the card says so. OAuth appears only when a real
          provider flow ships (none for LLM subscriptions in OSS yet).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Badge variant="outline" className="text-[10px]">
              {METHOD_LABEL["api-key"]}
            </Badge>
            metered or access key
          </span>
          <span className="inline-flex items-center gap-1">
            <Badge variant="outline" className="text-[10px]">
              {METHOD_LABEL["subscription-key"]}
            </Badge>
            plan billed by provider
          </span>
          <span className="inline-flex items-center gap-1">
            <Badge variant="outline" className="text-[10px]">
              {METHOD_LABEL.sdk}
            </Badge>
            Cursor @cursor/sdk (same User API key)
          </span>
          <span className="inline-flex items-center gap-1">
            <Badge variant="outline" className="text-[10px]">
              {METHOD_LABEL.pat}
            </Badge>
            Snowflake Cortex today
          </span>
          <span className="inline-flex items-center gap-1">
            <Badge variant="outline" className="text-[10px]">
              {METHOD_LABEL.oauth}
            </Badge>
            LLM OAuth not shipped yet
          </span>
        </div>

        <ul className="flex flex-col gap-2">
          {shipped.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-1 rounded-md border bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="text-sm font-medium">{p.name}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {p.methods
                  .filter((m) => m.status === "available")
                  .map((m) => (
                    <Badge
                      key={m.id}
                      variant="outline"
                      className="text-[10px] font-normal"
                    >
                      {m.label}
                    </Badge>
                  ))}
              </div>
            </li>
          ))}
        </ul>

        {gaps.length > 0 ? (
          <Alert>
            <KeyRoundIcon />
            <AlertTitle>Not offered as live Connect yet</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 flex flex-col gap-1.5">
                {gaps.flatMap((p) =>
                  p.methods
                    .filter(
                      (m) => m.status === "planned" || m.status === "unavailable"
                    )
                    .map((m) => (
                      <li
                        key={`${p.id}-${m.id}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span className="font-medium text-foreground">
                          {p.name}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {m.label}
                        </Badge>
                        <MethodStatusBadge status={m.status} />
                        {m.note ? (
                          <span className="text-muted-foreground">{m.note}</span>
                        ) : null}
                      </li>
                    ))
                )}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
