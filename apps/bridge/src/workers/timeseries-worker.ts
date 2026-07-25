import { parentPort } from "node:worker_threads";
import { initTimeseriesStore, getTimeseriesStore } from "../services/timeseries-store.js";

if (parentPort) {
  void initTimeseriesStore().then(() => {
    parentPort!.on(
      "message",
      async (msg: {
        type: string;
        dataset?: string;
        symbol?: string;
        entity?: string;
        rows?: unknown[];
        tenantId?: string;
      }) => {
        const entity = msg.entity ?? msg.symbol;
        if (msg.type === "append_batch" && msg.dataset && entity && msg.rows) {
          getTimeseriesStore().appendBatch(
            msg.dataset,
            entity,
            msg.rows as Array<Record<string, string | number | boolean | null>>,
            { tenantId: msg.tenantId }
          );
        } else if (msg.type === "flush") {
          await getTimeseriesStore().flushAll();
        }
      }
    );
  });
}
