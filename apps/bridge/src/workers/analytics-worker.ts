import { parentPort } from "node:worker_threads";
import { initTimeseriesStore, getTimeseriesStore } from "../services/timeseries-store.js";

if (parentPort) {
  void initTimeseriesStore().then(() => {
    parentPort!.on("message", async (msg: { type: string; sql?: string }) => {
      if (msg.type === "query" && msg.sql) {
        const rows = await getTimeseriesStore().analyticsQuery(msg.sql);
        parentPort!.postMessage({ type: "result", rows });
      }
    });
  });
}
