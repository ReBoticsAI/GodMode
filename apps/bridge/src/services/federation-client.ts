import type { ResolvedConnection } from "./connection-resolver.js";

export interface FederationExecuteResult {
  ok: boolean;
  enqueued?: string;
  file?: string;
  error?: string;
  mode: "local" | "remote";
}

/** POST an SC queue line to a remote Bridge federation endpoint. */
export async function federationExecuteRemote(
  remoteUrl: string,
  remoteToken: string,
  line: string,
  chartbookKey?: string
): Promise<FederationExecuteResult> {
  const base = remoteUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/api/federation/sc/execute`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${remoteToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ line, chartbookKey }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    enqueued?: string;
    file?: string;
    error?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: body.error ?? `Remote federation HTTP ${res.status}`,
      mode: "remote",
    };
  }
  return {
    ok: body.ok === true,
    enqueued: body.enqueued,
    file: body.file,
    mode: "remote",
  };
}

export async function federationHealthRemote(
  remoteUrl: string,
  remoteToken: string
): Promise<{ ok: boolean; detail?: string }> {
  const base = remoteUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/api/federation/health`, {
    headers: { Authorization: `Bearer ${remoteToken}` },
  });
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { ok?: boolean; sc?: { ok?: boolean; detail?: string } };
  return {
    ok: body.ok === true,
    detail: body.sc?.detail ?? (body.sc?.ok ? "sc_ok" : "sc_unknown"),
  };
}

export type ScDispatchContext = {
  resolved: ResolvedConnection;
  line: string;
  chartbookKey?: string;
  localEnqueue: (line: string, chartbookKey?: string) => string;
};

/** Route an SC queue line locally or to the owner's federated Bridge. */
export async function dispatchScLine(ctx: ScDispatchContext): Promise<FederationExecuteResult> {
  if (ctx.resolved.mode === "remote") {
    return federationExecuteRemote(
      ctx.resolved.remoteUrl,
      ctx.resolved.remoteToken,
      ctx.line,
      ctx.chartbookKey
    );
  }
  if (ctx.resolved.mode === "offline") {
    return { ok: false, error: ctx.resolved.reason, mode: "local" };
  }
  const file = ctx.localEnqueue(ctx.line, ctx.chartbookKey);
  return { ok: true, file, enqueued: ctx.line, mode: "local" };
}
