import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { config } from "../../config.js";

export type CpuServerState =
  | "stopped"
  | "starting"
  | "running"
  | "error"
  | "stopping";

export interface CpuServerStatus {
  role: string;
  state: CpuServerState;
  pid: number | null;
  modelPath: string | null;
  modelName: string | null;
  port: number;
  host: string;
  healthOk: boolean;
  logs: string[];
  error: string | null;
  startedAt: string | null;
}

export interface CpuServerOptions {
  /** Short label used in logs/status, e.g. "embedder". */
  role: string;
  modelPath: string;
  port: number;
  ctxSize: number;
  threads: number;
  /** Extra llama-server flags (e.g. ["--embeddings", "--pooling", "mean"]). */
  extraArgs?: string[];
}

/**
 * Minimal CPU-pinned llama-server wrapper. Mirrors the spawn/health/log
 * lifecycle of {@link LlmManager} but is deliberately tiny and ALWAYS forces
 * `-ngl 0` so it can never steal VRAM from the GPU main model. Used to drive
 * the embedder that powers semantic (RAG) memory retrieval.
 */
export class CpuLlamaServer {
  private proc: ChildProcess | null = null;
  private state: CpuServerState = "stopped";
  private logs: string[] = [];
  private error: string | null = null;
  private startedAt: string | null = null;
  private healthOk = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: CpuServerOptions) {}

  get port(): number {
    return this.opts.port;
  }

  get host(): string {
    return config.embeddings.serverHost;
  }

  getBaseUrl(): string {
    return `http://${this.host}:${this.opts.port}`;
  }

  isReady(): boolean {
    return this.state === "running" && this.healthOk;
  }

  getStatus(): CpuServerStatus {
    return {
      role: this.opts.role,
      state: this.state,
      pid: this.proc?.pid ?? null,
      modelPath: this.opts.modelPath,
      modelName: this.opts.modelPath
        ? this.opts.modelPath.split(/[\\/]/).pop() ?? null
        : null,
      port: this.opts.port,
      host: this.host,
      healthOk: this.healthOk,
      logs: [...this.logs],
      error: this.error,
      startedAt: this.startedAt,
    };
  }

  async start(): Promise<CpuServerStatus> {
    if (this.state === "running" || this.state === "starting") {
      return this.getStatus();
    }

    // Hub / Docker: attach to host-managed embedder (do not spawn inside Alpine).
    if (config.embeddings.external) {
      this.state = "starting";
      this.error = null;
      this.logs = [];
      this.startedAt = new Date().toISOString();
      this.healthOk = false;
      this.proc = null;
      this.pushLog(
        `[${this.opts.role}] attaching to external embedder at ${this.getBaseUrl()}`
      );
      await this.waitForReady(120_000);
      this.startHealthPoll();
      return this.getStatus();
    }

    if (!fs.existsSync(config.ai.llamaServerBin)) {
      this.state = "error";
      this.error = `llama-server not found: ${config.ai.llamaServerBin}`;
      return this.getStatus();
    }
    if (!fs.existsSync(this.opts.modelPath)) {
      this.state = "error";
      this.error = `model not found: ${this.opts.modelPath}`;
      return this.getStatus();
    }

    this.state = "starting";
    this.error = null;
    this.logs = [];
    this.startedAt = new Date().toISOString();
    this.healthOk = false;

    const args = this.buildArgs();
    this.pushLog(`[${this.opts.role}] starting: ${config.ai.llamaServerBin} ${args.join(" ")}`);

    const proc = spawn(config.ai.llamaServerBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc = proc;

    const onData = (buf: Buffer, prefix = "") => {
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) this.pushLog(prefix + line);
        this.parseLine(line);
      }
    };
    proc.stdout?.on("data", (b: Buffer) => onData(b));
    proc.stderr?.on("data", (b: Buffer) => onData(b, "[stderr] "));

    proc.on("exit", (code) => {
      this.pushLog(`[${this.opts.role}] process exited with code ${code ?? "null"}`);
      this.proc = null;
      this.state = code === 0 ? "stopped" : "error";
      if (code !== 0 && code != null) {
        this.error = `llama-server exited with code ${code}`;
      }
      this.stopHealthPoll();
    });

    proc.on("error", (err) => {
      this.error = err.message;
      this.state = "error";
      this.pushLog(`[${this.opts.role}] process error: ${err.message}`);
    });

    await this.waitForReady(120_000);
    this.startHealthPoll();
    return this.getStatus();
  }

  async stop(): Promise<CpuServerStatus> {
    this.state = "stopping";
    this.stopHealthPoll();
    if (config.embeddings.external) {
      this.proc = null;
      this.state = "stopped";
      this.healthOk = false;
      this.pushLog(`[${this.opts.role}] detached from external embedder (left running on host)`);
      return this.getStatus();
    }
    if (this.proc) {
      this.proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1000));
      if (this.proc) this.proc.kill("SIGKILL");
      this.proc = null;
    }
    this.state = "stopped";
    this.healthOk = false;
    return this.getStatus();
  }

  private buildArgs(): string[] {
    const args = [
      "-m",
      this.opts.modelPath,
      "--host",
      this.host,
      "--port",
      String(this.opts.port),
      // Hard CPU pin — never offload to the GPU hosting the main model.
      "-ngl",
      "0",
      "--ctx-size",
      String(this.opts.ctxSize),
    ];
    if (this.opts.threads > 0) args.push("--threads", String(this.opts.threads));
    if (this.opts.extraArgs?.length) args.push(...this.opts.extraArgs);
    return args;
  }

  private pushLog(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 300) this.logs.shift();
  }

  private parseLine(line: string): void {
    if (line.includes("HTTP server is listening") || line.includes("server is listening")) {
      this.state = "running";
      this.healthOk = true;
    }
  }

  private startHealthPoll(): void {
    this.stopHealthPoll();
    this.healthTimer = setInterval(() => void this.pingHealth(), 5000);
  }

  private stopHealthPoll(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async pingHealth(): Promise<void> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      this.healthOk = res.ok;
      if (res.ok && this.state === "starting") this.state = "running";
    } catch {
      this.healthOk = false;
    }
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.getBaseUrl()}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          this.state = "running";
          this.healthOk = true;
          return;
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (this.proc && this.state === "starting") this.state = "running";
  }
}
