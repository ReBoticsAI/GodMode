import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import type { AppDatabase } from "../db.js";
import { createAdapter, getAdapter } from "./ai-adapters.js";

export interface TrainingJobConfig {
  adapterName: string;
  domain?: string;
  description?: string;
  datasetPath?: string;
  datasetId?: string;
  baseModel?: string;
  epochs?: number;
  learningRate?: number;
  loraRank?: number;
  [key: string]: unknown;
}

export interface TrainingJobRow {
  id: string;
  adapter_id: string;
  status: string;
  config_json: string;
  log: string;
  progress: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/**
 * Spawns the Python QLoRA trainer (scripts/ai/unsloth-train.py) for a job,
 * streaming stdout into the ai_training_jobs.log column and parsing progress
 * markers. The trainer writes <adapterId>.gguf into the adapters dir; on
 * success we register/point the adapter row at that file.
 */
export class AiTrainingManager {
  private activeProc: ChildProcess | null = null;
  private activeJobId: string | null = null;

  constructor(private readonly db: AppDatabase) {}

  private pythonBin(): string {
    return process.env.PYTHON_BIN ?? (os.platform() === "win32" ? "python" : "python3");
  }

  private scriptPath(): string {
    return path.join(config.repoRoot, "scripts", "ai", "unsloth-train.py");
  }

  listJobs(limit = 100): TrainingJobRow[] {
    return this.db
      .prepare(`SELECT * FROM ai_training_jobs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as TrainingJobRow[];
  }

  getJob(id: string): TrainingJobRow | null {
    return (
      (this.db.prepare(`SELECT * FROM ai_training_jobs WHERE id = ?`).get(id) as
        | TrainingJobRow
        | undefined) ?? null
    );
  }

  /**
   * Route-facing entry point: creates and launches a training job, returning
   * the new job id. Rejects if a job is already running (one trainer at a time).
   */
  async startJob(jobConfig: TrainingJobConfig): Promise<string> {
    if (this.activeJobId) {
      throw new Error("A training job is already running");
    }
    if (!jobConfig.adapterName || !String(jobConfig.adapterName).trim()) {
      throw new Error("adapterName required");
    }
    const job = this.createJob(jobConfig);
    return job.id;
  }

  /** Kills the currently running trainer (if any). */
  cancelJob(): boolean {
    if (!this.activeProc || !this.activeJobId) return false;
    const jobId = this.activeJobId;
    try {
      this.activeProc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    this.markError(jobId, "Cancelled by user");
    this.activeProc = null;
    this.activeJobId = null;
    return true;
  }

  /** Creates the adapter (disabled) + job row, then kicks off the trainer. */
  createJob(jobConfig: TrainingJobConfig): TrainingJobRow {
    const resolved = this.resolveJobConfig(jobConfig);

    const adapter = createAdapter(this.db, {
      name: resolved.adapterName,
      path: path.join(config.ai.adaptersDir, `${slug(resolved.adapterName)}.gguf`),
      description: resolved.description ?? null,
      domain: resolved.domain ?? null,
      enabled: false,
      defaultScale: 1.0,
    });

    const jobId = uuidv4();
    const outputDir = config.ai.adaptersDir;
    fs.mkdirSync(outputDir, { recursive: true });
    const spec = {
      adapterId: slug(resolved.adapterName),
      adapterDbId: adapter.id,
      outputDir,
      baseModel: resolved.baseModel,
      llamaCppDir: resolved.llamaCppDir,
      datasetPath: resolved.datasetPath,
      epochs: resolved.epochs ?? 3,
      learningRate: resolved.learningRate ?? 2e-4,
      loraRank: resolved.loraRank ?? 16,
      domain: resolved.domain,
      description: resolved.description,
      adapterName: resolved.adapterName,
    };

    this.db
      .prepare(
        `INSERT INTO ai_training_jobs (id, adapter_id, status, config_json, log, progress)
         VALUES (?, ?, 'pending', ?, '', 0)`
      )
      .run(jobId, adapter.id, JSON.stringify(spec));

    this.spawnTrainer(jobId, spec);
    return this.getJob(jobId)!;
  }

  /** Normalizes job config: resolves dataset id, defaults base model + llama.cpp dir. */
  private resolveJobConfig(jobConfig: TrainingJobConfig): TrainingJobConfig {
    let datasetPath = jobConfig.datasetPath?.trim() || undefined;
    if (!datasetPath && jobConfig.datasetId) {
      const row = this.db
        .prepare(`SELECT path FROM ai_datasets WHERE id = ?`)
        .get(jobConfig.datasetId) as { path: string } | undefined;
      if (!row?.path) {
        throw new Error(`Dataset not found: ${jobConfig.datasetId}`);
      }
      datasetPath = row.path;
    }
    if (!datasetPath) {
      throw new Error("datasetPath or datasetId required");
    }
    if (!fs.existsSync(datasetPath)) {
      throw new Error(`Dataset file not found: ${datasetPath}`);
    }

    return {
      ...jobConfig,
      datasetPath,
      baseModel: jobConfig.baseModel?.trim() || config.ai.trainBaseModel,
      llamaCppDir: config.ai.llamaCppDir,
      epochs: jobConfig.epochs ?? 3,
      learningRate: jobConfig.learningRate ?? 2e-4,
      loraRank: jobConfig.loraRank ?? 16,
    };
  }

  private spawnTrainer(jobId: string, spec: Record<string, unknown>): void {
    const specFile = path.join(os.tmpdir(), `ai-train-${jobId}.json`);
    try {
      fs.writeFileSync(specFile, JSON.stringify(spec, null, 2), "utf8");
    } catch (err) {
      this.markError(jobId, `Failed to write job spec: ${String(err)}`);
      return;
    }

    const script = this.scriptPath();
    if (!fs.existsSync(script)) {
      this.markError(jobId, `Trainer script not found: ${script}`);
      return;
    }

    this.db
      .prepare(
        `UPDATE ai_training_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?`
      )
      .run(jobId);

    let proc: ChildProcess;
    try {
      proc = spawn(this.pythonBin(), [script, specFile], {
        cwd: config.repoRoot,
        windowsHide: true,
      });
    } catch (err) {
      this.markError(jobId, `Failed to spawn python: ${String(err)}`);
      return;
    }
    this.activeProc = proc;
    this.activeJobId = jobId;

    const onChunk = (buf: Buffer) => {
      const text = buf.toString("utf8");
      this.appendLog(jobId, text);
      const m = text.match(/progress=(\d+(?:\.\d+)?)%/);
      if (m) this.setProgress(jobId, Number(m[1]) / 100);
    };
    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);

    proc.on("error", (err) => {
      this.markError(jobId, err.message);
    });

    proc.on("exit", (code) => {
      if (this.activeJobId === jobId) {
        this.activeProc = null;
        this.activeJobId = null;
      }
      try {
        fs.unlinkSync(specFile);
      } catch {
        /* ignore */
      }
      // A cancel already marked the job as errored; don't overwrite it.
      const current = this.getJob(jobId);
      if (current && (current.status === "error" || current.status === "done")) {
        return;
      }
      if (code === 0) {
        const adapterDbId = String(spec.adapterDbId ?? "");
        const adapterId = String(spec.adapterId ?? "");
        const outFile = path.join(String(spec.outputDir), `${adapterId}.gguf`);
        if (adapterDbId && getAdapter(this.db, adapterDbId) && fs.existsSync(outFile)) {
          // point adapter at the produced file (trainer may have chosen the name)
          this.db
            .prepare(`UPDATE ai_adapters SET path = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(outFile, adapterDbId);
        }
        this.db
          .prepare(
            `UPDATE ai_training_jobs SET status = 'done', progress = 1, finished_at = datetime('now') WHERE id = ?`
          )
          .run(jobId);
      } else {
        this.markError(jobId, `Trainer exited with code ${code ?? "null"}`);
      }
    });
  }

  private appendLog(jobId: string, text: string): void {
    this.db
      .prepare(`UPDATE ai_training_jobs SET log = substr(log || ?, -20000) WHERE id = ?`)
      .run(text, jobId);
  }

  private setProgress(jobId: string, progress: number): void {
    this.db.prepare(`UPDATE ai_training_jobs SET progress = ? WHERE id = ?`).run(progress, jobId);
  }

  private markError(jobId: string, message: string): void {
    this.db
      .prepare(
        `UPDATE ai_training_jobs SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?`
      )
      .run(message, jobId);
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "adapter";
}
