import { startBridge } from "./bootstrap.js";

startBridge().catch((err) => {
  console.error("[bridge] fatal startup error:", err);
  process.exit(1);
});
