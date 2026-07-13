/**
 * Embedding GGUF detection for chat picker exclusion.
 * Run: npx tsx apps/bridge/src/services/__tests__/embedding-gguf.test.ts
 */
import assert from "node:assert/strict";
import { isEmbeddingGguf } from "../llm-manager.js";

assert.equal(isEmbeddingGguf("embeddinggemma-300M-Q8_0.gguf"), true);
assert.equal(isEmbeddingGguf("/mnt/storage/models/embeddinggemma-300M-Q8_0.gguf"), true);
assert.equal(isEmbeddingGguf("nomic-embed-text-v1.5.Q8_0.gguf"), true);
assert.equal(isEmbeddingGguf("bge-large-en-v1.5-f16.gguf"), true);
assert.equal(isEmbeddingGguf("gemma-4-26B_q4_0-it.gguf"), false);
assert.equal(isEmbeddingGguf("mmproj-gemma-4.gguf"), false);

console.log("embedding-gguf.test.ts: ok");
