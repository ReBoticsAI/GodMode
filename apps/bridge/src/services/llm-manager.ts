import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { AppDatabase } from "../db.js";

export type LlmServerState =
  | "stopped"
  | "starting"
  | "running"
  | "error"
  | "stopping";

export interface ScannedModel {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  mmprojPath: string | null;
  isMmproj: boolean;
  isMultimodal: boolean;
}

export interface LlmStatus {
  state: LlmServerState;
  pid: number | null;
  modelPath: string | null;
  modelName: string | null;
  mmprojPath: string | null;
  port: number;
  host: string;
  ctxSize: number;
  gpuLayers: number;
  healthOk: boolean;
  tokensPerSecond: number | null;
  logs: string[];
  error: string | null;
  startedAt: string | null;
}

export interface SamplingParams {
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
  presencePenalty: number;
  frequencyPenalty: number;
  maxTokens: number;
  seed: number;
}

export interface LlmSettings {
  // read-only environment
  llamaServerBin: string;
  modelDirs: string;
  host: string;
  // server launch flags
  activeModelPath: string;
  ctxSize: number;
  gpuLayers: number;
  port: number;
  flashAttn: string;
  threads: number;
  batchSize: number;
  ubatchSize: number;
  parallel: number;
  jinja: boolean;
  /** Free-form extra flags appended verbatim (e.g. MoE CPU offload, KV quant). */
  extraArgs: string;
  autoStart: boolean;
  // sampling / generation
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
  presencePenalty: number;
  frequencyPenalty: number;
  maxTokens: number;
  seed: number;
  // prompt / gemma4
  systemPrompt: string;
  enableThinking: boolean;
  thinkingEfficiency: "normal" | "low";
  nativeTools: boolean;
  // memory engine
  memoryMode: "approval" | "auto";
}

/** Persisted request snapshot for the "what was sent to the LLM" inspector. */
export interface LastRequest {
  at: string;
  systemPrompt: string;
  sampling: SamplingParams;
  messages: Array<{ role: string; preview: string; images: number }>;
  endpoint: string;
  sections?: Array<{
    id: string;
    label: string;
    enabled: boolean;
    included: boolean;
    preview: string;
    charCount: number;
    inSystemPrompt: boolean;
  }>;
  omitted?: string[];
}

function readSetting(db: AppDatabase, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM ai_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeSetting(db: AppDatabase, key: string, value: string): void {
  db.prepare(
    `INSERT INTO ai_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value);
}

/**
 * Splits a free-form flag string into argv tokens, honoring single/double
 * quotes so JSON-valued flags survive intact, e.g.
 *   --n-cpu-moe 8 --cache-type-k q8_0 --chat-template-kwargs '{"enable_thinking":true}'
 * Quotes are stripped from the emitted tokens; whitespace outside quotes splits.
 */
function splitArgs(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) tokens.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has) tokens.push(cur);
  return tokens;
}

function isMmprojFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("mmproj") || lower.includes("mmproj-");
}

/**
 * Pairs a model with a compatible mmproj projector by matching the leading
 * family token (e.g. "gemma-4-e4b"). A projector only works with its own model
 * architecture, so we never fall back to an unrelated projector.
 */
function pairMmproj(modelPath: string, mmprojFiles: string[]): string | null {
  const base = path.basename(modelPath, ".gguf").toLowerCase();
  // Tokens that identify the model family, e.g. ["gemma", "4", "e4b"].
  const familyTokens = base
    .split(/[-_.]/)
    .filter(
      (t) =>
        t &&
        !/^(it|q\d.*|ud|f16|bf16|obliterated|instruct|gguf|xl|k|m|s|l|0|1)$/i.test(
          t
        )
    )
    .slice(0, 3);

  let best: { mm: string; score: number } | null = null;
  for (const mm of mmprojFiles) {
    const mmBase = path.basename(mm, ".gguf").toLowerCase();
    const score = familyTokens.filter((t) => mmBase.includes(t)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { mm, score };
    }
  }
  // Require EVERY family token (including the variant, e.g. "e4b") to match,
  // not just the leading "gemma". Otherwise a gemma-4-E4B projector would be
  // wrongly attached to a different gemma-4 variant (e.g. the 26B text model),
  // which loads an incompatible projector and breaks the server launch.
  if (best && familyTokens.length > 0 && best.score === familyTokens.length) {
    return best.mm;
  }
  return null;
}

export class LlmManager {
  private proc: ChildProcess | null = null;
  private state: LlmServerState = "stopped";
  private logs: string[] = [];
  private error: string | null = null;
  private modelPath: string | null = null;
  private mmprojPath: string | null = null;
  private startedAt: string | null = null;
  private tokensPerSecond: number | null = null;
  private healthOk = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastRequest: LastRequest | null = null;

  constructor(private readonly db: AppDatabase) {}

  getSettings(db: AppDatabase = this.db): LlmSettings {
    const num = (key: string, dflt: number) =>
      Number(readSetting(db, key) ?? dflt);
    return {
      llamaServerBin: config.ai.llamaServerBin,
      modelDirs: config.ai.modelDirs.join(";"),
      host: config.ai.serverHost,
      activeModelPath: readSetting(db, "activeModelPath") ?? "",
      ctxSize: num("ctxSize", config.ai.defaultCtxSize),
      gpuLayers: num("gpuLayers", config.ai.defaultGpuLayers),
      port: num("port", config.ai.serverPort),
      flashAttn: readSetting(db, "flashAttn") ?? config.ai.flashAttn,
      threads: num("threads", config.ai.defaultThreads),
      batchSize: num("batchSize", config.ai.defaultBatchSize),
      ubatchSize: num("ubatchSize", config.ai.defaultUbatchSize),
      parallel: num("parallel", config.ai.defaultParallel),
      jinja: (readSetting(db, "jinja") ?? String(config.ai.defaultJinja)) === "true",
      extraArgs: readSetting(db, "extraArgs") ?? config.ai.defaultExtraArgs,
      autoStart: readSetting(db, "autoStart") === "true",
      temperature: num("temperature", config.ai.defaultTemperature),
      topP: num("topP", config.ai.defaultTopP),
      topK: num("topK", config.ai.defaultTopK),
      minP: num("minP", config.ai.defaultMinP),
      repeatPenalty: num("repeatPenalty", config.ai.defaultRepeatPenalty),
      presencePenalty: num("presencePenalty", config.ai.defaultPresencePenalty),
      frequencyPenalty: num("frequencyPenalty", config.ai.defaultFrequencyPenalty),
      maxTokens: num("maxTokens", config.ai.defaultMaxTokens),
      seed: num("seed", config.ai.defaultSeed),
      systemPrompt: readSetting(db, "systemPrompt") ?? config.ai.defaultSystemPrompt,
      enableThinking:
        (readSetting(db, "enableThinking") ??
          String(config.ai.defaultEnableThinking)) === "true",
      thinkingEfficiency:
        (readSetting(db, "thinkingEfficiency") ??
          config.ai.defaultThinkingEfficiency) === "low"
          ? "low"
          : "normal",
      nativeTools:
        (readSetting(db, "nativeTools") ?? String(config.ai.defaultNativeTools)) !==
        "false",
      memoryMode:
        (readSetting(db, "memoryMode") ?? "approval") === "auto"
          ? "auto"
          : "approval",
    };
  }

  updateSettings(patch: Record<string, unknown>): LlmSettings {
    const numKeys = [
      "ctxSize",
      "gpuLayers",
      "port",
      "threads",
      "batchSize",
      "ubatchSize",
      "parallel",
      "temperature",
      "topP",
      "topK",
      "minP",
      "repeatPenalty",
      "presencePenalty",
      "frequencyPenalty",
      "maxTokens",
      "seed",
    ];
    for (const key of numKeys) {
      if (patch[key] != null && Number.isFinite(Number(patch[key]))) {
        writeSetting(this.db, key, String(Number(patch[key])));
      }
    }
    if (patch.flashAttn != null)
      writeSetting(this.db, "flashAttn", String(patch.flashAttn));
    if (patch.jinja != null)
      writeSetting(this.db, "jinja", patch.jinja ? "true" : "false");
    if (patch.extraArgs != null)
      writeSetting(this.db, "extraArgs", String(patch.extraArgs));
    if (patch.autoStart != null)
      writeSetting(this.db, "autoStart", patch.autoStart ? "true" : "false");
    if (patch.activeModelPath != null)
      writeSetting(this.db, "activeModelPath", String(patch.activeModelPath));
    if (patch.systemPrompt != null)
      writeSetting(this.db, "systemPrompt", String(patch.systemPrompt));
    if (patch.enableThinking != null)
      writeSetting(this.db, "enableThinking", patch.enableThinking ? "true" : "false");
    if (patch.thinkingEfficiency != null)
      writeSetting(
        this.db,
        "thinkingEfficiency",
        patch.thinkingEfficiency === "low" ? "low" : "normal"
      );
    if (patch.nativeTools != null)
      writeSetting(this.db, "nativeTools", patch.nativeTools ? "true" : "false");
    if (patch.memoryMode != null)
      writeSetting(
        this.db,
        "memoryMode",
        patch.memoryMode === "auto" ? "auto" : "approval"
      );
    return this.getSettings();
  }

  /** Default base prompt, so the UI can offer a "reset to default". */
  getDefaultSystemPrompt(): string {
    return config.ai.defaultSystemPrompt;
  }

  /** OpenAI-style sampling params used for every chat completion. */
  getSamplingParams(db: AppDatabase = this.db): SamplingParams {
    const s = this.getSettings(db);
    return {
      temperature: s.temperature,
      topP: s.topP,
      topK: s.topK,
      minP: s.minP,
      repeatPenalty: s.repeatPenalty,
      presencePenalty: s.presencePenalty,
      frequencyPenalty: s.frequencyPenalty,
      maxTokens: s.maxTokens,
      seed: s.seed,
    };
  }

  recordLastRequest(req: LastRequest): void {
    this.lastRequest = req;
  }

  getLastRequest(): LastRequest | null {
    return this.lastRequest;
  }

  scanModels(): ScannedModel[] {
    const seen = new Set<string>();
    const allFiles: string[] = [];
    const mmprojFiles: string[] = [];

    for (const dir of config.ai.modelDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.toLowerCase().endsWith(".gguf")) continue;
        const full = path.resolve(dir, name);
        if (seen.has(full)) continue;
        seen.add(full);
        if (isMmprojFile(name)) {
          mmprojFiles.push(full);
        } else {
          allFiles.push(full);
        }
      }
    }

    return allFiles
      .map((full) => {
        const name = path.basename(full);
        const stat = fs.statSync(full);
        const mmproj = pairMmproj(full, mmprojFiles);
        return {
          id: full,
          name,
          path: full,
          sizeBytes: stat.size,
          mmprojPath: mmproj,
          isMmproj: false,
          isMultimodal: mmproj != null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getStatus(): LlmStatus {
    const settings = this.getSettings();
    return {
      state: this.state,
      pid: this.proc?.pid ?? null,
      modelPath: this.modelPath,
      modelName: this.modelPath ? path.basename(this.modelPath) : null,
      mmprojPath: this.mmprojPath,
      port: Number(settings.port),
      host: config.ai.serverHost,
      ctxSize: Number(settings.ctxSize),
      gpuLayers: Number(settings.gpuLayers),
      healthOk: this.healthOk,
      tokensPerSecond: this.tokensPerSecond,
      logs: [...this.logs],
      error: this.error,
      startedAt: this.startedAt,
    };
  }

  /** Resolve a basename or relative path to a scanned model under modelDirs. */
  private resolveModelPath(modelPath: string): string | null {
    if (fs.existsSync(modelPath) && path.isAbsolute(modelPath)) return path.resolve(modelPath);
    if (fs.existsSync(modelPath)) return path.resolve(modelPath);
    const base = path.basename(modelPath);
    const hit = this.scanModels().find(
      (m) => m.path === modelPath || m.name === modelPath || m.name === base
    );
    return hit?.path ?? null;
  }

  async start(modelPath?: string): Promise<LlmStatus> {
    if (this.state === "running" || this.state === "starting") {
      return this.getStatus();
    }

    const settings = this.getSettings();
    let target =
      modelPath ??
      ((settings.activeModelPath as string) ||
        this.scanModels().find((m) => !m.name.toLowerCase().includes("thinking"))?.path);

    if (target) {
      const resolved = this.resolveModelPath(target);
      if (resolved) target = resolved;
    }

    if (target && modelPath) {
      const resolved = path.resolve(target);
      const allowed = config.ai.modelDirs.some((dir) => {
        const root = path.resolve(dir);
        return resolved === root || resolved.startsWith(root + path.sep);
      });
      if (!allowed) {
        this.state = "error";
        this.error = "Model path is outside configured model directories";
        return this.getStatus();
      }
    }

    if (!target || !fs.existsSync(target)) {
      this.state = "error";
      this.error = "No model selected or file not found";
      return this.getStatus();
    }

    const models = this.scanModels();
    const model = models.find((m) => m.path === target);
    this.modelPath = target;
    this.mmprojPath = model?.mmprojPath ?? null;
    writeSetting(this.db, "activeModelPath", target);

    // Hub / Docker: use host-managed llama-server (do not spawn inside the container).
    if (config.ai.external) {
      const port = config.ai.serverPort;
      writeSetting(this.db, "port", String(port));
      this.state = "starting";
      this.error = null;
      this.logs = [];
      this.startedAt = new Date().toISOString();
      this.healthOk = false;
      this.proc = null;
      this.pushLog(
        `Attaching to external llama-server at http://${config.ai.serverHost}:${port}`
      );
      await this.waitForReady(port, 120_000);
      this.startHealthPoll(port);
      return this.getStatus();
    }

    if (!fs.existsSync(config.ai.llamaServerBin)) {
      this.state = "error";
      this.error = `llama-server not found: ${config.ai.llamaServerBin}`;
      return this.getStatus();
    }

    this.state = "starting";
    this.error = null;
    this.logs = [];
    this.startedAt = new Date().toISOString();
    this.healthOk = false;

    const args = this.buildArgs(target, this.mmprojPath);

    this.pushLog(`Starting: ${config.ai.llamaServerBin} ${args.join(" ")}`);

    const proc = spawn(config.ai.llamaServerBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc = proc;

    proc.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) this.pushLog(line);
        this.parseLine(line);
      }
    });

    proc.stderr?.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) this.pushLog(`[stderr] ${line}`);
        this.parseLine(line);
      }
    });

    proc.on("exit", (code) => {
      this.pushLog(`Process exited with code ${code ?? "null"}`);
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
      this.pushLog(`Process error: ${err.message}`);
    });

    await this.waitForReady(Number(settings.port), 120_000);
    this.startHealthPoll(Number(settings.port));
    return this.getStatus();
  }

  async stop(): Promise<LlmStatus> {
    this.state = "stopping";
    this.stopHealthPoll();
    if (config.ai.external) {
      // Host-managed process — detach only; do not kill systemd llama-server.
      this.proc = null;
      this.state = "stopped";
      this.healthOk = false;
      this.pushLog("Detached from external llama-server (left running on host)");
      return this.getStatus();
    }
    if (this.proc) {
      this.proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1500));
      if (this.proc) {
        this.proc.kill("SIGKILL");
      }
      this.proc = null;
    }
    this.state = "stopped";
    this.healthOk = false;
    return this.getStatus();
  }

  async restart(modelPath?: string): Promise<LlmStatus> {
    await this.stop();
    return this.start(modelPath);
  }

  shutdown(): void {
    void this.stop();
  }

  /**
   * On bridge boot, optionally re-launch the last active model so a running
   * assistant survives a server restart. Controlled by the `autoStart` setting.
   */
  async maybeAutoStart(): Promise<void> {
    const settings = this.getSettings();
    if (settings.autoStart !== true) return;
    const model = settings.activeModelPath as string;
    if (!model) return;
    this.pushLog("Auto-starting last active model…");
    try {
      await this.start(model);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  getServerBaseUrl(): string {
    const settings = this.getSettings();
    const port = config.ai.external ? config.ai.serverPort : Number(settings.port);
    return `http://${config.ai.serverHost}:${port}`;
  }

  isReady(): boolean {
    return this.state === "running" && this.healthOk;
  }

  /**
   * Builds the full llama-server argv from the persisted settings. Shared
   * between `start()` and the read-only launch-command preview so the UI shows
   * exactly what will be run.
   */
  private buildArgs(target: string, mmprojPath: string | null): string[] {
    const s = this.getSettings();
    const args = [
      "-m",
      target,
      "--host",
      config.ai.serverHost,
      "--port",
      String(s.port),
      "-ngl",
      String(s.gpuLayers),
      "--ctx-size",
      String(s.ctxSize),
      // Flash attention shrinks KV-cache memory and speeds up attention; the
      // 5060 Ti supports it, so pin it on rather than relying on auto.
      "--flash-attn",
      s.flashAttn,
      "--batch-size",
      String(s.batchSize),
      "--ubatch-size",
      String(s.ubatchSize),
      "--parallel",
      String(s.parallel),
    ];
    if (s.threads > 0) args.push("--threads", String(s.threads));
    // Use the model's embedded chat template (Gemma 4 needs it for its
    // <|turn> tokens, tool calls, and image/audio markers).
    if (s.jinja) args.push("--jinja");
    if (mmprojPath && fs.existsSync(mmprojPath)) {
      args.push("--mmproj", mmprojPath);
    }
    const adapterPaths = this.getEnabledAdapterPaths();
    for (const p of adapterPaths) {
      if (fs.existsSync(p)) args.push("--lora", p);
    }
    if (adapterPaths.length > 0) args.push("--lora-init-without-apply");
    // Verbatim passthrough for flags the typed settings don't cover (MoE CPU
    // offload, tensor overrides, KV cache quant). Appended last so they can
    // override earlier defaults if needed.
    if (s.extraArgs && s.extraArgs.trim()) {
      args.push(...splitArgs(s.extraArgs));
    }
    return args;
  }

  getEnabledAdapterPaths(): string[] {
    try {
      const rows = this.db
        .prepare(`SELECT path FROM ai_adapters WHERE enabled = 1 ORDER BY name ASC`)
        .all() as Array<{ path: string }>;
      return rows.map((r) => r.path).filter((p) => fs.existsSync(p));
    } catch {
      return [];
    }
  }

  async proxyLoraAdapters(
    method: "GET" | "POST",
    body?: unknown
  ): Promise<unknown> {
    const base = this.getServerBaseUrl();
    const res = await fetch(`${base}/lora-adapters`, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? []) : undefined,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Resolves the argv that a start would use for the active/selected model,
   * without spawning anything. Returns null if no model is resolvable.
   */
  previewLaunchCommand(): { bin: string; args: string[] } | null {
    const settings = this.getSettings();
    const target =
      this.modelPath ||
      settings.activeModelPath ||
      this.scanModels().find((m) => !m.name.toLowerCase().includes("thinking"))?.path;
    if (!target) return null;
    const model = this.scanModels().find((m) => m.path === target);
    return {
      bin: config.ai.llamaServerBin,
      args: this.buildArgs(target, model?.mmprojPath ?? null),
    };
  }

  private pushLog(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 500) this.logs.shift();
  }

  /**
   * Extracts runtime signals from a llama-server log line: the readiness
   * marker and the token-generation speed. llama-server reports timing on
   * stderr as `eval time = ... ( ..., N tokens per second)`; we capture the
   * generation eval line (not the prompt-eval line) for the live t/s display.
   */
  private parseLine(line: string): void {
    if (line.includes("HTTP server is listening") || line.includes("server is listening")) {
      this.state = "running";
      this.healthOk = true;
    }
    if (/(^|[^t])eval time =/.test(line) && !line.includes("prompt eval time")) {
      const m = line.match(/([\d.]+)\s*tokens per second/i);
      if (m) this.tokensPerSecond = Number(m[1]);
    }
  }

  private startHealthPoll(port: number): void {
    this.stopHealthPoll();
    this.healthTimer = setInterval(() => {
      void this.pingHealth(port);
    }, 5000);
  }

  private stopHealthPoll(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async pingHealth(port: number): Promise<void> {
    try {
      const res = await fetch(`http://${config.ai.serverHost}:${port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      this.healthOk = res.ok;
      if (res.ok && this.state === "starting") this.state = "running";
    } catch {
      this.healthOk = false;
    }
  }

  private async waitForReady(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://${config.ai.serverHost}:${port}/health`, {
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
    if (this.proc && this.state === "starting") {
      this.state = "running";
    }
  }
}
