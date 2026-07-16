import {
  createRecordApi,
  deleteRecordApi,
  runRecordActionApi,
  updateRecordApi,
  type RecordRowClient,
} from "./object-types-api";
import { randomId } from "./random-id";

export type AgentWorkObjectType =
  | "Agent"
  | "AgentAssignment"
  | "TaskCard"
  | "CardComment"
  | "Workflow"
  | "WorkflowRun"
  | "WorkflowComment"
  | "Schedule"
  | "CalendarEvent";

export function agentWorkDto<T>(row: RecordRowClient): T {
  return { id: row.id, ...row.data } as T;
}

export async function createAgentWorkRecord<T>(
  objectType: AgentWorkObjectType,
  data: Record<string, unknown>
): Promise<T> {
  return agentWorkDto<T>(await createRecordApi(objectType, data));
}

export async function updateAgentWorkRecord<T>(
  objectType: AgentWorkObjectType,
  id: string,
  data: Record<string, unknown>
): Promise<T> {
  return agentWorkDto<T>(await updateRecordApi(objectType, id, data));
}

export async function deleteAgentWorkRecord(
  objectType: AgentWorkObjectType,
  id: string
): Promise<{ ok: boolean }> {
  await deleteRecordApi(objectType, id);
  return { ok: true };
}

export function runAgentWorkAction<T>(
  objectType: AgentWorkObjectType,
  action: string,
  input: Record<string, unknown>,
  id?: string,
  confirmed = false
): Promise<T> {
  return runRecordActionApi(objectType, action, input, {
    id,
    confirmed,
    idempotencyKey: randomId(),
  }) as Promise<T>;
}
