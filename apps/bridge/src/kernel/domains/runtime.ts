import {
  WRITE_PERMISSIONS,
  type BuiltinSpec,
  type FieldSpec,
} from "./shared.js";
import {
  runtimeAdapterRegistrations,
} from "../adapters/runtime.js";

const LABELS: Record<string, string> = {
  ChatSession: "Chat Session",
  ChatMessage: "Chat Message",
  ModelAdapter: "Model Adapter",
  EmbeddingRuntime: "Embedding Runtime",
  CapabilityIndex: "Capability Index",
  IntelligenceSettings: "Intelligence Settings",
  PromptFlow: "Prompt Flow",
  VaultSecret: "Vault Secret",
  ProviderCredential: "Provider Credential",
  ModelRuntime: "Model Runtime",
  PromptQueueJob: "Prompt Queue Job",
  Dataset: "Dataset",
  MemoryMaintenance: "Memory Maintenance",
  AutonomousRuntime: "Autonomous Runtime",
  TrainingJob: "Training Job",
  InferenceRuntime: "Inference Runtime",
  IntegrationRuntime: "Integration Runtime",
};

const FIELD_TYPES: Record<string, FieldSpec> = {
  priority: ["priority", "Int"],
  pid: ["pid", "Int"],
  port: ["port", "Int"],
  ctx_size: ["ctx_size", "Int"],
  row_count: ["row_count", "Int"],
  progress: ["progress", "Float"],
  health_ok: ["health_ok", "Check"],
  connected: ["connected", "Check"],
  enabled: ["enabled", "Check"],
  enabled_override: ["enabled_override", "Check"],
  index_rows: ["index_rows", "Int"],
  default_scale: ["default_scale", "Float"],
  config: ["config", "JSON"],
  assembled: ["assembled", "JSON"],
  scopes: ["scopes", "JSON"],
};

const WRITABLE: Record<string, string[]> = {
  ChatSession: ["title"],
  ChatMessage: ["chat_id", "role", "content"],
  ModelAdapter: [
    "name",
    "path",
    "description",
    "domain",
    "enabled",
    "default_scale",
  ],
  IntelligenceSettings: [
    "active_model_path",
    "ctx_size",
    "gpu_layers",
    "port",
    "flash_attn",
    "threads",
    "batch_size",
    "ubatch_size",
    "parallel",
    "jinja",
    "extra_args",
    "auto_start",
    "temperature",
    "top_p",
    "top_k",
    "min_p",
    "repeat_penalty",
    "presence_penalty",
    "frequency_penalty",
    "max_tokens",
    "seed",
    "system_prompt",
    "enable_thinking",
    "thinking_efficiency",
    "native_tools",
    "memory_mode",
  ],
  PromptFlow: ["agent_id", "config"],
  VaultSecret: ["name", "value"],
  ProviderCredential: ["agent_id", "provider", "label", "api_key"],
};

const REQUIRED: Record<string, string[]> = {
  ChatMessage: ["chat_id", "role", "content"],
  ModelAdapter: ["name", "path"],
  VaultSecret: ["name", "value"],
  ProviderCredential: ["provider", "api_key"],
};

export const RUNTIME_SPECS: BuiltinSpec[] =
  runtimeAdapterRegistrations.map((registration) => ({
    name: registration.objectType,
    label: LABELS[registration.objectType] ?? registration.objectType,
    module: "runtime",
    id: registration.adapterId,
    table: `kernel_${registration.adapterId}`,
    database: registration.database,
    operations: [...registration.operations],
    actions: [...registration.actions],
    writable: WRITABLE[registration.objectType],
    required: REQUIRED[registration.objectType],
    permissions: registration.operations.some(
      (operation) =>
        operation === "create" ||
        operation === "update" ||
        operation === "delete"
    )
      ? WRITE_PERMISSIONS
      : undefined,
    accessPolicy:
      registration.database === "core" ? "platform-admin" : "tenant-local",
    fields: registration.fields.map(
      (field) => FIELD_TYPES[field] ?? field
    ),
  }));
