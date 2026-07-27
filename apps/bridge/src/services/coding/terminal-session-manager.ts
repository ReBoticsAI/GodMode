/**
 * Shared sandboxed PTY sessions (#162 / #112).
 * Humans attach via WS/xterm; agents create/read/write/monitor the same sessions.
 */
import { EventEmitter } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  assertSandboxReadyForTerminal,
  buildBubblewrapArgs,
  codingTerminalEgressHosts,
  codingTerminalNetPolicy,
  interactiveShellCommand,
  requiresTerminalSandbox,
  scrubTerminalEnv,
  type CodingTerminalNet,
} from "./terminal-sandbox.js";
import {
  startTerminalEgressProxy,
  type TerminalEgressProxyHandle,
} from "./terminal-egress-proxy.js";
import { resolveCodingRoot, resolveRepoPath } from "./fs-tools.js";

const MAX_SCROLLBACK_CHARS = 512 * 1024;
const MONITOR_BATCH_MS = 200;

export type TerminalSessionInfo = {
  sessionId: string;
  name: string;
  cwd: string;
  running: boolean;
  sandboxed: boolean;
  netMode: CodingTerminalNet | "host";
  lastLine: string;
  attachedClients: number;
  exitCode: number | null;
  createdAt: number;
};

type PtyHandle = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (code: number) => void) => void;
};

type Session = {
  id: string;
  tenantKey: string;
  name: string;
  codingRoot: string;
  cwd: string;
  sandboxed: boolean;
  netMode: CodingTerminalNet | "host";
  pty: PtyHandle;
  scrollback: string;
  byteOffset: number;
  attached: Set<WebSocket>;
  exitCode: number | null;
  closed: boolean;
  createdAt: number;
  proxy: TerminalEgressProxyHandle | null;
  emitter: EventEmitter;
};

function tenantKey(tenantId?: string | null): string {
  return String(tenantId ?? "").trim() || "local";
}

function lastLineOf(text: string): string {
  const parts = text.replace(/\r\n/g, "\n").split("\n");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]?.length) return parts[i]!.slice(-200);
  }
  return "";
}

function appendScrollback(session: Session, chunk: string): void {
  session.scrollback += chunk;
  session.byteOffset += Buffer.byteLength(chunk, "utf8");
  if (session.scrollback.length > MAX_SCROLLBACK_CHARS) {
    session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK_CHARS);
  }
  session.emitter.emit("data", chunk);
  for (const ws of session.attached) {
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({ type: "stdout", sessionId: session.id, data: chunk }));
      } catch {
        /* ignore */
      }
    }
  }
}

let ptyModule: typeof import("node-pty") | null | undefined;

async function loadPty(): Promise<typeof import("node-pty")> {
  if (ptyModule === null) {
    throw new Error("node-pty is unavailable on this host");
  }
  if (ptyModule) return ptyModule;
  try {
    ptyModule = await import("node-pty");
    return ptyModule;
  } catch (err) {
    ptyModule = null;
    throw new Error(
      `node-pty failed to load: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function spawnHostPty(opts: {
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}): Promise<PtyHandle> {
  const pty = await loadPty();
  const shell =
    process.platform === "win32"
      ? process.env.COMSPEC || "cmd.exe"
      : process.env.SHELL || "/bin/bash";
  const args =
    process.platform === "win32"
      ? []
      : shell.includes("bash")
        ? ["-l"]
        : [];
  const proc = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env as Record<string, string>,
  });
  return {
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    },
    onData: (cb) => {
      proc.onData(cb);
    },
    onExit: (cb) => {
      proc.onExit(({ exitCode }) => cb(exitCode ?? 0));
    },
  };
}

async function spawnSandboxedPty(opts: {
  codingRoot: string;
  cwd: string;
  net: CodingTerminalNet;
  shellCmd: string;
  cols: number;
  rows: number;
  proxyUrl?: string;
  socketRel?: string;
  env: NodeJS.ProcessEnv;
}): Promise<PtyHandle> {
  const pty = await loadPty();
  const bwrapArgs = buildBubblewrapArgs({
    codingRoot: opts.codingRoot,
    cwd: opts.cwd,
    net: opts.net,
    command: opts.shellCmd,
    proxyUrl: opts.proxyUrl,
    socketRel: opts.socketRel,
  });
  const proc = pty.spawn("bwrap", bwrapArgs, {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.codingRoot,
    env: opts.env as Record<string, string>,
  });
  return {
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    },
    onData: (cb) => {
      proc.onData(cb);
    },
    onExit: (cb) => {
      proc.onExit(({ exitCode }) => cb(exitCode ?? 0));
    },
  };
}

const sessions = new Map<string, Session>();

function sessionMapKey(tenantId: string | null | undefined, sessionId: string): string {
  return `${tenantKey(tenantId)}:${sessionId}`;
}

export function getTerminalSession(
  sessionId: string,
  tenantId?: string | null
): Session | null {
  return sessions.get(sessionMapKey(tenantId, sessionId)) ?? null;
}

export function listTerminalSessions(tenantId?: string | null): TerminalSessionInfo[] {
  const key = tenantKey(tenantId);
  const out: TerminalSessionInfo[] = [];
  for (const session of sessions.values()) {
    if (session.tenantKey !== key) continue;
    out.push({
      sessionId: session.id,
      name: session.name,
      cwd: path.relative(session.codingRoot, session.cwd).replace(/\\/g, "/") || ".",
      running: !session.closed,
      sandboxed: session.sandboxed,
      netMode: session.netMode,
      lastLine: lastLineOf(session.scrollback),
      attachedClients: session.attached.size,
      exitCode: session.exitCode,
      createdAt: session.createdAt,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createTerminalSession(opts: {
  tenantId?: string | null;
  root?: string;
  name?: string;
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}): Promise<TerminalSessionInfo> {
  const codingRoot = resolveCodingRoot({
    tenantId: opts.tenantId,
    root: opts.root,
  });
  const cwd = resolveRepoPath(opts.cwd?.trim() || ".", {
    tenantId: opts.tenantId,
    root: opts.root,
  });
  const sandboxed = requiresTerminalSandbox();
  if (sandboxed) {
    assertSandboxReadyForTerminal();
  }

  const netMode = sandboxed ? codingTerminalNetPolicy() : ("host" as const);
  let proxy: TerminalEgressProxyHandle | null = null;
  if (sandboxed && netMode === "allowlist") {
    proxy = await startTerminalEgressProxy({
      codingRoot,
      allowlist: codingTerminalEgressHosts(),
    });
  }

  const shellCmd = interactiveShellCommand({ shell: opts.shell });
  const cols = Math.max(20, Math.min(Number(opts.cols ?? 120), 400));
  const rows = Math.max(5, Math.min(Number(opts.rows ?? 32), 120));
  const env = scrubTerminalEnv();

  let pty: PtyHandle;
  try {
    if (sandboxed) {
      pty = await spawnSandboxedPty({
        codingRoot,
        cwd,
        net: netMode as CodingTerminalNet,
        shellCmd,
        cols,
        rows,
        proxyUrl: proxy?.jailProxyUrl,
        socketRel: proxy?.socketRel,
        env,
      });
    } else {
      pty = await spawnHostPty({ cwd, cols, rows, env });
    }
  } catch (err) {
    await proxy?.close().catch(() => undefined);
    throw err;
  }

  const id = randomUUID();
  const session: Session = {
    id,
    tenantKey: tenantKey(opts.tenantId),
    name: String(opts.name ?? "").trim() || `session-${id.slice(0, 8)}`,
    codingRoot,
    cwd,
    sandboxed,
    netMode,
    pty,
    scrollback: "",
    byteOffset: 0,
    attached: new Set(),
    exitCode: null,
    closed: false,
    createdAt: Date.now(),
    proxy,
    emitter: new EventEmitter(),
  };
  session.emitter.setMaxListeners(50);

  pty.onData((data) => appendScrollback(session, data));
  pty.onExit(async (code) => {
    session.exitCode = code;
    session.closed = true;
    session.emitter.emit("exit", code);
    for (const ws of session.attached) {
      if (ws.readyState === 1) {
        try {
          ws.send(
            JSON.stringify({
              type: "exit",
              sessionId: session.id,
              exitCode: code,
            })
          );
        } catch {
          /* ignore */
        }
      }
    }
    session.attached.clear();
    if (session.proxy) {
      await session.proxy.close().catch(() => undefined);
      session.proxy = null;
    }
  });

  sessions.set(sessionMapKey(opts.tenantId, id), session);
  return listTerminalSessions(opts.tenantId).find((s) => s.sessionId === id)!;
}

export function readTerminalSession(opts: {
  sessionId: string;
  tenantId?: string | null;
  sinceOffset?: number;
  maxChars?: number;
}): { sessionId: string; data: string; offset: number; running: boolean; exitCode: number | null } {
  const session = getTerminalSession(opts.sessionId, opts.tenantId);
  if (!session) throw new Error(`Unknown terminal session: ${opts.sessionId}`);
  const since = Math.max(0, Number(opts.sinceOffset ?? 0));
  // Approximate: use char slice from end relative to tracked byteOffset
  const full = session.scrollback;
  const maxChars = Math.min(
    Math.max(Number(opts.maxChars ?? 32_000), 1),
    MAX_SCROLLBACK_CHARS
  );
  let data = full;
  if (since > 0 && session.byteOffset > since) {
    // Best-effort: return trailing content when offset is stale/partial
    const approxSkip = Math.max(0, full.length - (session.byteOffset - since));
    data = full.slice(approxSkip);
  }
  if (data.length > maxChars) data = data.slice(-maxChars);
  return {
    sessionId: session.id,
    data,
    offset: session.byteOffset,
    running: !session.closed,
    exitCode: session.exitCode,
  };
}

export function writeTerminalSession(opts: {
  sessionId: string;
  tenantId?: string | null;
  data: string;
}): { sessionId: string; ok: boolean } {
  const session = getTerminalSession(opts.sessionId, opts.tenantId);
  if (!session) throw new Error(`Unknown terminal session: ${opts.sessionId}`);
  if (session.closed) throw new Error(`Terminal session closed: ${opts.sessionId}`);
  session.pty.write(String(opts.data ?? ""));
  return { sessionId: session.id, ok: true };
}

export function resizeTerminalSession(opts: {
  sessionId: string;
  tenantId?: string | null;
  cols: number;
  rows: number;
}): void {
  const session = getTerminalSession(opts.sessionId, opts.tenantId);
  if (!session || session.closed) return;
  session.pty.resize(
    Math.max(20, Math.min(opts.cols, 400)),
    Math.max(5, Math.min(opts.rows, 120))
  );
}

export async function closeTerminalSession(opts: {
  sessionId: string;
  tenantId?: string | null;
}): Promise<{ sessionId: string; closed: boolean }> {
  const key = sessionMapKey(opts.tenantId, opts.sessionId);
  const session = sessions.get(key);
  if (!session) return { sessionId: opts.sessionId, closed: false };
  if (!session.closed) {
    session.pty.kill();
    session.closed = true;
  }
  if (session.proxy) {
    await session.proxy.close().catch(() => undefined);
    session.proxy = null;
  }
  sessions.delete(key);
  return { sessionId: opts.sessionId, closed: true };
}

export function attachTerminalWs(
  ws: WebSocket,
  opts: { sessionId: string; tenantId?: string | null }
): { ok: true } | { ok: false; error: string } {
  const session = getTerminalSession(opts.sessionId, opts.tenantId);
  if (!session) return { ok: false, error: "session not found" };
  if (session.closed) return { ok: false, error: "session closed" };
  session.attached.add(ws);
  // Replay a tail of scrollback for the new client
  const tail = session.scrollback.slice(-16_000);
  if (tail && ws.readyState === 1) {
    ws.send(
      JSON.stringify({
        type: "stdout",
        sessionId: session.id,
        data: tail,
        replay: true,
      })
    );
  }
  return { ok: true };
}

export function detachTerminalWs(
  ws: WebSocket,
  opts: { sessionId: string; tenantId?: string | null }
): void {
  const session = getTerminalSession(opts.sessionId, opts.tenantId);
  session?.attached.delete(ws);
}

/** Claude Monitor analogue: batch new PTY lines until idle/pattern/exit/abort. */
export async function monitorTerminalSession(opts: {
  sessionId: string;
  tenantId?: string | null;
  idleMs?: number;
  pattern?: string;
  maxBytes?: number;
  abortSignal?: AbortSignal;
  onBatch?: (text: string) => void;
}): Promise<{
  sessionId: string;
  reason: "idle" | "pattern" | "exit" | "abort" | "cap";
  bytes: number;
  exitCode: number | null;
}> {
  const session = getTerminalSession(opts.sessionId, opts.tenantId);
  if (!session) throw new Error(`Unknown terminal session: ${opts.sessionId}`);

  const idleMs = Math.min(Math.max(Number(opts.idleMs ?? 8_000), 500), 120_000);
  const maxBytes = Math.min(Math.max(Number(opts.maxBytes ?? 64_000), 1024), 256_000);
  const pattern = String(opts.pattern ?? "").trim();
  let re: RegExp | null = null;
  if (pattern) {
    try {
      re = new RegExp(pattern);
    } catch {
      throw new Error(`Invalid monitor pattern: ${pattern}`);
    }
  }

  let bytes = 0;
  let batch = "";
  let reason: "idle" | "pattern" | "exit" | "abort" | "cap" = "idle";
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const flushBatch = () => {
    if (!batch) return;
    const text = batch;
    batch = "";
    opts.onBatch?.(text);
  };

  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      reason = "idle";
      finish();
    }, idleMs);
  };

  let settled = false;
  let resolveFn: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  const finish = () => {
    if (settled) return;
    settled = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (batchTimer) clearTimeout(batchTimer);
    flushBatch();
    session.emitter.off("data", onData);
    session.emitter.off("exit", onExit);
    opts.abortSignal?.removeEventListener("abort", onAbort);
    resolveFn();
  };

  const onData = (chunk: string) => {
    bytes += Buffer.byteLength(chunk, "utf8");
    batch += chunk;
    if (!batchTimer) {
      batchTimer = setTimeout(() => {
        batchTimer = null;
        flushBatch();
      }, MONITOR_BATCH_MS);
    }
    if (re && re.test(session.scrollback.slice(-8_000))) {
      reason = "pattern";
      finish();
      return;
    }
    if (bytes >= maxBytes) {
      reason = "cap";
      finish();
      return;
    }
    bumpIdle();
  };

  const onExit = () => {
    reason = "exit";
    finish();
  };

  const onAbort = () => {
    reason = "abort";
    finish();
  };

  if (session.closed) {
    return {
      sessionId: session.id,
      reason: "exit",
      bytes: 0,
      exitCode: session.exitCode,
    };
  }

  session.emitter.on("data", onData);
  session.emitter.on("exit", onExit);
  opts.abortSignal?.addEventListener("abort", onAbort);
  bumpIdle();
  await done;

  return {
    sessionId: session.id,
    reason,
    bytes,
    exitCode: session.exitCode,
  };
}

/** Test helper: clear all sessions. */
export async function resetTerminalSessionsForTests(): Promise<void> {
  const ids = [...sessions.keys()];
  for (const key of ids) {
    const session = sessions.get(key);
    if (!session) continue;
    try {
      session.pty.kill();
    } catch {
      /* ignore */
    }
    if (session.proxy) await session.proxy.close().catch(() => undefined);
    sessions.delete(key);
  }
}
