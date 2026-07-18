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
    roles?: Array<"viewer" | "editor" | "owner" | "intelligence">;
    cancellable?: boolean;
  }>;
}

export interface RecordRowClient {
  id: string;
  objectType: string;
  data: Record<string, unknown>;
  version?: string;
}

export interface OperationRunClient {
  id: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  progress?: number;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export async function fetchObjectTypes(): Promise<ObjectTypeClient[]> {
  const res = await api<{ objectTypes: ObjectTypeClient[] }>("/object-types");
  return res.objectTypes;
}

export async function fetchObjectType(name: string): Promise<ObjectTypeClient> {
  return api<ObjectTypeClient>(`/object-types/${encodeURIComponent(name)}`);
}

/** Optional agent workspace scope for Record API calls (dual workspaces). */
export type RecordScopeOpts = { agentId?: string };

function withAgentScope(path: string, opts?: RecordScopeOpts): string {
  if (!opts?.agentId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}agentId=${encodeURIComponent(opts.agentId)}`;
}

export async function fetchRecords(
  objectType: string,
  opts?: {
    parentId?: string | null;
    limit?: number;
    offset?: number;
    sort?: string;
    direction?: "asc" | "desc";
    filters?: Record<string, unknown>;
    agentId?: string;
  }
): Promise<{
  objectType?: string;
  records: RecordRowClient[];
  total: number;
  limit?: number;
  offset?: number;
}> {
  const q = new URLSearchParams();
  if (opts && "parentId" in (opts ?? {})) {
    q.set(
      "parent_id",
      opts?.parentId == null ? "null" : String(opts.parentId)
    );
  }
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  if (opts?.offset != null) q.set("offset", String(opts.offset));
  if (opts?.sort) q.set("sort", opts.sort);
  if (opts?.direction) q.set("direction", opts.direction);
  for (const [name, value] of Object.entries(opts?.filters ?? {})) {
    if (value != null && value !== "") q.set(`filters[${name}]`, String(value));
  }
  if (opts?.agentId) q.set("agentId", opts.agentId);
  const qs = q.toString();
  return api(
    `/records/${encodeURIComponent(objectType)}${qs ? `?${qs}` : ""}`
  );
}

export async function fetchRecord(
  objectType: string,
  id: string,
  opts?: RecordScopeOpts
): Promise<RecordRowClient> {
  return api(
    withAgentScope(
      `/records/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`,
      opts
    )
  );
}

export async function createRecordApi(
  objectType: string,
  data: Record<string, unknown>,
  opts?: RecordScopeOpts
): Promise<RecordRowClient> {
  return api(withAgentScope(`/records/${encodeURIComponent(objectType)}`, opts), {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function updateRecordApi(
  objectType: string,
  id: string,
  data: Record<string, unknown>,
  expectedVersion?: string,
  opts?: RecordScopeOpts
): Promise<RecordRowClient> {
  return api(
    withAgentScope(
      `/records/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`,
      opts
    ),
    {
      method: "PUT",
      headers: expectedVersion ? { "If-Match": expectedVersion } : undefined,
      body: JSON.stringify({ data }),
    }
  );
}

export async function deleteRecordApi(
  objectType: string,
  id: string,
  expectedVersion?: string,
  opts?: RecordScopeOpts
): Promise<void> {
  await api(
    withAgentScope(
      `/records/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`,
      opts
    ),
    {
      method: "DELETE",
      headers: expectedVersion ? { "If-Match": expectedVersion } : undefined,
    }
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
    expectedVersion?: string;
    confirmed?: boolean;
    agentId?: string;
  }
): Promise<unknown> {
  const target = withAgentScope(
    opts?.id
      ? `/records/${encodeURIComponent(objectType)}/${encodeURIComponent(opts.id)}/actions/${encodeURIComponent(action)}`
      : `/records/${encodeURIComponent(objectType)}/actions/${encodeURIComponent(action)}`,
    opts
  );
  const headers: Record<string, string> = {};
  if (opts?.confirmationId) {
    headers["X-Kernel-Confirmation"] = opts.confirmationId;
  }
  if (opts?.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }
  if (opts?.expectedVersion) {
    headers["If-Match"] = opts.expectedVersion;
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

export async function fetchOperationRun(id: string): Promise<OperationRunClient> {
  const row = await fetchRecord("OperationRun", id);
  return {
    id: row.id,
    status: String(row.data.status) as OperationRunClient["status"],
    progress:
      typeof row.data.progress === "number" ? row.data.progress : undefined,
    result: row.data.result_json,
    errorCode:
      typeof row.data.error_code === "string" ? row.data.error_code : undefined,
    errorMessage:
      typeof row.data.error_message === "string"
        ? row.data.error_message
        : undefined,
  };
}

export async function waitForOperationRun(
  id: string,
  opts: { signal?: AbortSignal; intervalMs?: number } = {}
): Promise<OperationRunClient> {
  const intervalMs = Math.max(opts.intervalMs ?? 750, 100);
  for (;;) {
    opts.signal?.throwIfAborted();
    const run = await fetchOperationRun(id);
    if (["succeeded", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, intervalMs);
      opts.signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
          reject(opts.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });
  }
}
