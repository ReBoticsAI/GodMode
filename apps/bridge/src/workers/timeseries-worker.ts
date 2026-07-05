import { parentPort } from "node:worker_threads";
import { initTimeseriesStore, getTimeseriesStore } from "../services/timeseries-store.js";

if (parentPort) {
  void initTimeseriesStore().then(() => {
    parentPort!.on("message", async (msg: { type: string; dataset?: string; symbol?: string; rows?: unknown[] }) => {
      if (msg.type === "append_batch" && msg.dataset && msg.symbol && msg.rows) {
        getTimeseriesStore().appendBatch(
          msg.dataset as import("../services/timeseries-store.js").TimeseriesDataset,
          msg.symbol,
          msg.rows as Array<Record<string, string | number | boolean | null>>
        );
      } else if (msg.type === "flush") {
        await getTimeseriesStore().flushAll();
      }
    });
  });
}
