import {
  runRecordActionApi,
  type OperationRunClient,
  type RecordRowClient,
  waitForOperationRun,
} from "./object-types-api";
import { randomId } from "./random-id";

export type CodingAgentObjectType =
  | "ChatSession"
  | "ModelRuntime"
  | "EmbeddingRuntime"
  | "CapabilityIndex"
  | "PromptQueueJob"
  | "Dataset"
  | "MemoryMaintenance"
  | "AutonomousRuntime"
  | "TrainingJob"
  | "InferenceRuntime";

export interface CodingAgentActionOptions {
  id?: string;
  confirmed?: boolean;
  signal?: AbortSignal;
  waitForCompletion?: boolean;
}

function isOperationRun(value: unknown): value is { operationRunId: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { operationRunId?: unknown }).operationRunId === "string"
  );
}

export async function runCodingAgentAction<T>(
  objectType: CodingAgentObjectType,
  action: string,
  input: Record<string, unknown>,
  options: CodingAgentActionOptions = {}
): Promise<T | OperationRunClient> {
  const result = await runRecordActionApi(objectType, action, input, {
    id: options.id,
    confirmed: options.confirmed,
    idempotencyKey: randomId(),
  });
  if (options.waitForCompletion && isOperationRun(result)) {
    return waitForOperationRun(result.operationRunId, { signal: options.signal });
  }
  return result as T;
}

export function codingAgentDto<T>(row: RecordRowClient): T {
  return { id: row.id, ...row.data } as T;
}
