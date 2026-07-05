import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  getTimeseriesStore,
  type TimeseriesDataset,
} from "./timeseries-store.js";

const bridgeDir = path.dirname(fileURLToPath(import.meta.url));

export type WorkerKind = "timeseries" | "analytics" | "embed";

export interface WorkerPool {
  post(kind: WorkerKind, message: unknown): void;
  shutdown(): void;
}

/** Worker pool: timeseries/analytics flush off main thread when workers load; inline fallback otherwise. */
export function createWorkerPool(): WorkerPool {
  const workers = new Map<WorkerKind, Worker>();

  function spawnWorker(kind: WorkerKind): Worker | null {
    if (workers.has(kind)) return workers.get(kind)!;
    const scriptTs = path.join(bridgeDir, "..", "workers", `${kind}-worker.ts`);
    try {
      const w = new Worker(pathToFileURL(scriptTs).href, {
        execArgv: ["--import", "tsx"],
      });
      workers.set(kind, w);
      w.on("error", (err) => console.warn(`[worker:${kind}]`, err.message));
      return w;
    } catch (err) {
      console.warn(`[worker:${kind}] spawn failed, using main thread`, err);
      return null;
    }
  }

  return {
    post(kind, message) {
      if (kind === "timeseries") {
        const msg = message as {
          type: string;
          dataset?: TimeseriesDataset;
          symbol?: string;
          rows?: Array<Record<string, string | number | boolean | null>>;
        };
        const w = spawnWorker("timeseries");
        if (w) {
          w.postMessage(message);
          return;
        }
        if (msg.type === "append_batch" && msg.dataset && msg.symbol && msg.rows) {
          getTimeseriesStore().appendBatch(msg.dataset, msg.symbol, msg.rows);
        } else if (msg.type === "flush") {
          void getTimeseriesStore().flushAll();
        }
        return;
      }
      if (kind === "analytics") {
        const w = spawnWorker("analytics");
        if (w) w.postMessage(message);
        return;
      }
      const w = spawnWorker(kind);
      if (w) w.postMessage(message);
    },
    shutdown() {
      for (const w of workers.values()) void w.terminate();
      workers.clear();
      getTimeseriesStore().shutdown();
    },
  };
}
