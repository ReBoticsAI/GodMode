import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditAiToolParity,
  discoverStaticWriteToolNames,
} from "../audit-ai-tool-parity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("discoverStaticWriteToolNames finds write_file and submit_community_catalog_submission", () => {
  const writers = discoverStaticWriteToolNames();
  assert.ok(writers.includes("write_file"));
  assert.ok(writers.includes("submit_community_catalog_submission"));
  assert.ok(!writers.includes("prepare_community_catalog_submission"));
});

test("repo inventory passes parity audit", () => {
  const result = auditAiToolParity({ strict: true });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.ok(result.writerCount >= 40);
});

test("novel write tool fails parity audit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-parity-"));
  try {
    const registry = path.join(dir, "registry.ts");
    const inventory = path.join(dir, "inventory.json");
    fs.writeFileSync(
      registry,
      `export const AI_TOOL_REGISTRY = [
  { name: "write_file", write: true },
  { name: "brand_new_mutation", write: true },
];`
    );
    fs.writeFileSync(
      inventory,
      JSON.stringify({
        version: 1,
        tools: {
          write_file: { class: "infra_coding", rationale: "fs" },
        },
      })
    );
    const result = auditAiToolParity({
      registryPath: registry,
      inventoryPath: inventory,
      strict: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /brand_new_mutation/.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("inventory file is checked into the repo", () => {
  assert.ok(
    fs.existsSync(path.join(repoRoot, "scripts/ai-tool-parity-inventory.json"))
  );
  assert.ok(fs.existsSync(path.join(repoRoot, "docs/AI_TOOL_KERNEL_PARITY.md")));
});
