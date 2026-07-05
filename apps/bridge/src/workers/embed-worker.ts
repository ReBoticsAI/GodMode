import { parentPort } from "node:worker_threads";

/** Embedding worker placeholder — actual embed calls stay on the embedder llama-server; this worker handles batch post-processing. */
if (parentPort) {
  parentPort.on("message", (msg: { type: string; memoryId?: string; text?: string }) => {
    if (msg.type === "fts_sync" && msg.memoryId && msg.text) {
      parentPort!.postMessage({ type: "fts_sync_done", memoryId: msg.memoryId });
    }
  });
}
