import type { BuiltinSpec, FieldSpec } from "./shared.js";
import {
  runtimeAdapterRegistrations,
} from "../adapters/runtime.js";

const LABELS: Record<string, string> = {
  ChatSession: "Chat Session",
  ChatMessage: "Chat Message",
  ModelRuntime: "Model Runtime",
  PromptQueueJob: "Prompt Queue Job",
  Dataset: "Dataset",
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
    accessPolicy:
      registration.database === "core" ? "platform-admin" : "tenant-local",
    fields: registration.fields.map(
      (field) => FIELD_TYPES[field] ?? field
    ),
  }));
