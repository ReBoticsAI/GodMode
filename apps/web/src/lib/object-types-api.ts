import { api, ApiError } from "@/api";

export interface FieldDefClient {
  name: string;
  label: string;
  fieldType: string;
  required?: boolean;
  options?: string[];
  inList?: boolean;
  inForm?: boolean;
  description?: string;
}

export interface ObjectTypeClient {
  name: string;
  label: string;
  labelPlural?: string;
  description?: string;
  fields: FieldDefClient[];
  storage: { kind: string; adapterId?: string; tableName?: string };
  operations?: Array<"list" | "get" | "create" | "update" | "delete">;
  contractVersion?: number;
  actions?: Array<{
    name: string;
    label: string;
    description?: string;
    target?: "record" | "collection" | "bulk";
    effect?: "read" | "write" | "destructive" | "external";
    execution?: "sync" | "async";
    confirm?: boolean;
    confirmation?: { required: boolean; ttlSeconds?: number };
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }>;
}

export interface RecordRowClient {
  id: string;
  objectType: string;
  data: Record<string, unknown>;
}

export async function fetchObjectTypes(): Promise<ObjectTypeClient[]> {
  const res = await api<{ objectTypes: ObjectTypeClient[] }>("/object-types");
  return res.objectTypes;
}

export async function fetchObjectType(name: string): Promise<ObjectTypeClient> {
  return api<ObjectTypeClient>(`/object-types/${encodeURIComponent(name)}`);
}

export async function fetchRecords(
  objectType: string,
  opts?: { parentId?: string | null; limit?: number }
): Promise<{ records: RecordRowClient[]; total: number }> {
  const q = new URLSearchParams();
  if (opts && "parentId" in (opts ?? {})) {
    q.set(
      "parent_id",
      opts?.parentId == null ? "null" : String(opts.parentId)
    );
  }
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return api(
    `/records/${encodeURIComponent(objectType)}${qs ? `?${qs}` : ""}`
  );
}

export async function fetchRecord(
  objectType: string,
  id: string
): Promise<RecordRowClient> {
  return api(
    `/records/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`
  );
}

export async function createRecordApi(
  objectType: string,
  data: Record<string, unknown>
): Promise<RecordRowClient> {
  return api(`/records/${encodeURIComponent(objectType)}`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function updateRecordApi(
  objectType: string,
  id: string,
  data: Record<string, unknown>
): Promise<RecordRowClient> {
  return api(
    `/records/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify({ data }),
    }
  );
}

export async function deleteRecordApi(
  objectType: string,
  id: string
): Promise<void> {
  await api(
    `/records/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export async function runRecordActionApi(
  objectType: string,
  action: string,
  input: Record<string, unknown>,
  opts?: {
    id?: string;
    confirmationId?: string;
    idempotencyKey?: string;
    confirmed?: boolean;
  }
): Promise<unknown> {
  const target = opts?.id
    ? `/records/${encodeURIComponent(objectType)}/${encodeURIComponent(opts.id)}/actions/${encodeURIComponent(action)}`
    : `/records/${encodeURIComponent(objectType)}/actions/${encodeURIComponent(action)}`;
  const headers: Record<string, string> = {};
  if (opts?.confirmationId) {
    headers["X-Kernel-Confirmation"] = opts.confirmationId;
  }
  if (opts?.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }
  try {
    const response = await api<{ result: unknown }>(target, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    return response.result;
  } catch (error) {
    const confirmationId =
      error instanceof ApiError &&
      error.code === "KERNEL_CONFIRMATION_REQUIRED" &&
      error.details &&
      typeof error.details === "object" &&
      "confirmationId" in error.details
        ? String(
            (error.details as { confirmationId: unknown }).confirmationId
          )
        : null;
    if (!opts?.confirmed || !confirmationId) throw error;
    return runRecordActionApi(objectType, action, input, {
      ...opts,
      confirmationId,
      confirmed: false,
    });
  }
}
