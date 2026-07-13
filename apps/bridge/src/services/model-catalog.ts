import { getAgent, listSecrets, updateAgent } from "./agents/agents-db.js";
import { getCursorAuthStatus, listCursorSubscriptionModels } from "./cursor-subscription.js";
import type { AppDatabase } from "../db.js";
import type { CoreDatabase } from "../core-db.js";
import type { LlmManager } from "./llm-manager.js";
import { markLlmReady } from "./onboarding.js";
import { listSharedModelsForUser } from "./share-service.js";

export type CatalogModelSource = "local" | "cursor" | "provider" | "remote";

export interface CatalogModel {
  id: string;
  source: CatalogModelSource;
  label: string;
  /** Local GGUF absolute path */
  path?: string;
  /** Cursor / provider model id */
  model?: string;
  /** Marketplace / shared endpoint */
  endpointId?: string;
  provider?: "openai" | "anthropic" | "openai_compatible";
  multimodal?: boolean;
  active?: boolean;
}

const OPENAI_CATALOG = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "o3", label: "o3" },
  { id: "o4-mini", label: "o4-mini" },
];

const ANTHROPIC_CATALOG = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { id: "claude-haiku-4-20250514", label: "Claude Haiku 4" },
];

function secretLooksLike(name: string, needle: string): boolean {
  return name.toLowerCase().includes(needle);
}

export async function listModelCatalog(
  db: AppDatabase,
  llm: LlmManager,
  core?: CoreDatabase,
  userId?: string
): Promise<{ models: CatalogModel[]; active: CatalogModel | null }> {
  const agent = getAgent(db, "intelligence");
  const models: CatalogModel[] = [];

  const local = llm.scanModels().filter((m) => !m.isMmproj);
  const localStatus = llm.getStatus();
  for (const m of local) {
    const active =
      agent?.backend === "local" &&
      localStatus.state === "running" &&
      (agent.modelPath === m.path || localStatus.modelPath === m.path);
    models.push({
      id: `local:${m.path}`,
      source: "local",
      label: m.name.replace(/\.gguf$/i, ""),
      path: m.path,
      multimodal: m.isMultimodal,
      active,
    });
  }

  if (getCursorAuthStatus(db).connected) {
    try {
      const cursorModels = await listCursorSubscriptionModels(db);
      for (const m of cursorModels) {
        models.push({
          id: `cursor:${m.id}`,
          source: "cursor",
          label: m.label || m.id,
          model: m.id,
          active: agent?.backend === "cursor_cloud" && agent.config?.model === m.id,
        });
      }
    } catch {
      /* key missing / SDK error — omit Cursor section */
    }
  }

  const secrets = listSecrets(db).filter((s) => s.name !== "cursor_api_key");
  const hasOpenAi = secrets.some((s) => secretLooksLike(s.name, "openai") || secretLooksLike(s.name, "gpt"));
  const hasAnthropic = secrets.some(
    (s) => secretLooksLike(s.name, "anthropic") || secretLooksLike(s.name, "claude")
  );
  const hasAnyProviderSecret = secrets.length > 0;

  if (hasOpenAi || (hasAnyProviderSecret && !hasAnthropic)) {
    for (const m of OPENAI_CATALOG) {
      models.push({
        id: `provider:openai:${m.id}`,
        source: "provider",
        label: m.label,
        model: m.id,
        provider: "openai",
        active:
          agent?.backend === "provider" &&
          (agent.config?.provider ?? "openai") === "openai" &&
          agent.config?.model === m.id,
      });
    }
  }
  if (hasAnthropic) {
    for (const m of ANTHROPIC_CATALOG) {
      models.push({
        id: `provider:anthropic:${m.id}`,
        source: "provider",
        label: m.label,
        model: m.id,
        provider: "anthropic",
        active:
          agent?.backend === "provider" &&
          agent.config?.provider === "anthropic" &&
          agent.config?.model === m.id,
      });
    }
  }

  // Keep configured provider model visible even if not in the static list.
  if (
    agent?.backend === "provider" &&
    agent.config?.model &&
    !models.some((m) => m.source === "provider" && m.model === agent.config?.model)
  ) {
    models.push({
      id: `provider:${agent.config.provider ?? "openai"}:${agent.config.model}`,
      source: "provider",
      label: String(agent.config.model),
      model: String(agent.config.model),
      provider: (agent.config.provider as "openai" | "anthropic" | "openai_compatible") ?? "openai",
      active: true,
    });
  }

  if (core && userId) {
    try {
      const shared = listSharedModelsForUser(core, userId);
      for (const row of shared) {
        models.push({
          id: `remote:${row.endpointId}`,
          source: "remote",
          label: row.name || row.baseModelName || row.endpointId,
          endpointId: row.endpointId,
          active: agent?.backend === "remote" && agent.config?.endpointId === row.endpointId,
        });
      }
    } catch {
      /* share tables may not exist */
    }
  }

  const active = models.find((m) => m.active) ?? null;
  return { models, active };
}

export interface SelectModelInput {
  source: CatalogModelSource;
  path?: string;
  model?: string;
  provider?: "openai" | "anthropic" | "openai_compatible";
  endpointId?: string;
  apiKeyRef?: string;
}

export async function selectIntelligenceModel(
  db: AppDatabase,
  llm: LlmManager,
  input: SelectModelInput
): Promise<{ ok: true; active: CatalogModel }> {
  const agent = getAgent(db, "intelligence");
  if (!agent) throw new Error("Intelligence agent not found");

  if (input.source === "local") {
    const path = input.path?.trim();
    if (!path) throw new Error("Local model path required");
    updateAgent(db, "intelligence", {
      backend: "local",
      modelPath: path,
      config: {
        knowsUser: agent.config?.knowsUser !== false,
        codeAccess: agent.config?.codeAccess !== false,
      },
    });
    const status = llm.getStatus();
    if (status.state === "running" && status.modelPath !== path) {
      await llm.restart(path);
    } else if (status.state !== "running") {
      await llm.start(path);
    }
    markLlmReady(db);
    return {
      ok: true,
      active: {
        id: `local:${path}`,
        source: "local",
        label: path.split(/[/\\]/).pop()?.replace(/\.gguf$/i, "") ?? path,
        path,
        active: true,
      },
    };
  }

  if (input.source === "cursor") {
    if (!getCursorAuthStatus(db).connected) {
      throw new Error("Connect Cursor with an API key first");
    }
    const model = input.model?.trim() || "auto";
    updateAgent(db, "intelligence", {
      backend: "cursor_cloud",
      thinking: { ...agent.thinking, nativeTools: true },
      config: { ...agent.config, model },
    });
    markLlmReady(db);
    return {
      ok: true,
      active: {
        id: `cursor:${model}`,
        source: "cursor",
        label: model,
        model,
        active: true,
      },
    };
  }

  if (input.source === "provider") {
    const model = input.model?.trim();
    if (!model) throw new Error("Provider model id required");
    const provider = input.provider ?? "openai";
    const secrets = listSecrets(db).filter((s) => s.name !== "cursor_api_key");
    if (secrets.length === 0) {
      throw new Error("Add an API key in Vault → Secrets before using cloud provider models");
    }
    const preferred =
      secrets.find((s) =>
        provider === "anthropic"
          ? secretLooksLike(s.name, "anthropic") || secretLooksLike(s.name, "claude")
          : secretLooksLike(s.name, "openai") || secretLooksLike(s.name, "gpt")
      ) ?? secrets[0]!;
    const apiKeyRef = input.apiKeyRef || agent.config?.apiKeyRef || preferred.id;
    updateAgent(db, "intelligence", {
      backend: "provider",
      modelPath: null,
      config: {
        ...agent.config,
        provider,
        model,
        apiKeyRef,
        knowsUser: agent.config?.knowsUser !== false,
        codeAccess: agent.config?.codeAccess !== false,
      },
    });
    markLlmReady(db);
    return {
      ok: true,
      active: {
        id: `provider:${provider}:${model}`,
        source: "provider",
        label: model,
        model,
        provider,
        active: true,
      },
    };
  }

  if (input.source === "remote") {
    const endpointId = input.endpointId?.trim();
    if (!endpointId) throw new Error("Remote endpoint id required");
    updateAgent(db, "intelligence", {
      backend: "remote",
      modelPath: null,
      config: {
        ...agent.config,
        endpointId,
        knowsUser: agent.config?.knowsUser !== false,
        codeAccess: agent.config?.codeAccess !== false,
      },
    });
    markLlmReady(db);
    return {
      ok: true,
      active: {
        id: `remote:${endpointId}`,
        source: "remote",
        label: endpointId,
        endpointId,
        active: true,
      },
    };
  }

  throw new Error(`Unknown model source: ${input.source}`);
}
