export type RpcRequest = {
  kind: "req";
  id: number;
  method: string;
  params?: unknown;
};

export type RpcResponse = {
  kind: "res";
  id: number;
  result?: unknown;
  error?: string;
};

export type RpcEvent = {
  kind: "evt";
  method: string;
  params?: unknown;
};

export type RpcMsg = RpcRequest | RpcResponse | RpcEvent;

export function isRpcMsg(raw: unknown): raw is RpcMsg {
  if (!raw || typeof raw !== "object") return false;
  const kind = (raw as { kind?: unknown }).kind;
  return kind === "req" || kind === "res" || kind === "evt";
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class RpcPeer {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly send: (msg: RpcMsg) => void,
    private readonly onRequest: (
      method: string,
      params: unknown
    ) => Promise<unknown>,
    private readonly timeoutMs = 30_000
  ) {}

  handle(raw: unknown): void {
    if (!isRpcMsg(raw)) return;
    if (raw.kind === "res") {
      const wait = this.pending.get(raw.id);
      if (!wait) return;
      this.pending.delete(raw.id);
      clearTimeout(wait.timer);
      if (raw.error) wait.reject(new Error(raw.error));
      else wait.resolve(raw.result);
      return;
    }
    if (raw.kind === "req") {
      void this.onRequest(raw.method, raw.params).then(
        (result) => this.send({ kind: "res", id: raw.id, result }),
        (err: unknown) =>
          this.send({
            kind: "res",
            id: raw.id,
            error: err instanceof Error ? err.message : String(err),
          })
      );
    }
  }

  call(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`plugin child RPC timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ kind: "req", id, method, params });
    });
  }

  rejectAll(err: Error): void {
    for (const [id, wait] of this.pending) {
      clearTimeout(wait.timer);
      wait.reject(err);
      this.pending.delete(id);
    }
  }
}

export type SerializedFetchResult = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  bodyBase64: string;
};

export async function serializeFetchResponse(
  res: Response
): Promise<SerializedFetchResult> {
  const body = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    statusText: res.statusText,
    headers: [...res.headers.entries()],
    bodyBase64: body.toString("base64"),
  };
}

export function deserializeFetchResponse(raw: SerializedFetchResult): Response {
  return new Response(Buffer.from(raw.bodyBase64, "base64"), {
    status: raw.status,
    statusText: raw.statusText,
    headers: raw.headers,
  });
}
