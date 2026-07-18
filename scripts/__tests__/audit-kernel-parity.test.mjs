import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverOwnershipParityFindings,
  discoverReadWriteSymmetry,
  httpRecordContextSetsAgentId,
  buildDomainGapMatrix,
} from "../audit-kernel-parity-lib.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "godmode-parity-"));
  const write = (relative, source) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    return file;
  };
  return { root, write };
}

test("flags HTTP OperationContext missing agentId", () => {
  const { root, write } = fixture();
  write(
    "apps/bridge/src/kernel/routes.ts",
    `
import type { Request } from "express";
import type { OperationContext } from "./adapter-registry.js";
const context = (req: Request): OperationContext => ({
  tenantId: req.tenantId,
  userId: req.user?.id,
  role: "viewer",
  source: "http",
});
`
  );
  const result = httpRecordContextSetsAgentId(root);
  assert.equal(result.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("accepts HTTP OperationContext with agentId from query", () => {
  const { root, write } = fixture();
  write(
    "apps/bridge/src/kernel/routes.ts",
    `
import type { Request } from "express";
import type { OperationContext } from "./adapter-registry.js";
const context = (req: Request): OperationContext => ({
  tenantId: req.tenantId,
  userId: req.user?.id,
  agentId: typeof req.query.agentId === "string" ? req.query.agentId : undefined,
  role: "viewer",
  source: "http",
});
`
  );
  const result = httpRecordContextSetsAgentId(root);
  assert.equal(result.ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("detects tasks split-brain when agent UI + user-only adapter + legacy GET", () => {
  const { root, write } = fixture();
  write(
    "apps/bridge/src/kernel/routes.ts",
    `
const context = (req: Request): OperationContext => ({
  tenantId: req.tenantId,
  userId: req.user?.id,
  source: "http",
});
`
  );
  write(
    "apps/bridge/src/kernel/adapters/productivity.ts",
    `
import { ensureUserProject } from "../../services/user-productivity.js";
export const taskCardServiceAdapter = {
  create(db, def, data, ctx) {
    const projectId = ensureUserProject(ctx.userId, db);
  },
};
`
  );
  write(
    "apps/bridge/src/routes/ai.ts",
    `
router.get("/projects", (req, res) => {});
router.get("/calendar/events", (req, res) => {});
`
  );
  write(
    "apps/web/src/pages/Automations.tsx",
    `<ProjectsBoard scope={{ kind: "agent", agentId }} />`
  );
  write(
    "apps/web/src/components/intelligence/IntelligencePanel.tsx",
    `<CalendarBoard scope={{ kind: "agent", agentId: activeAgentId }} />`
  );
  write(
    "apps/web/src/api.ts",
    `
export const createAiMemory = (body: { text: string; agentId?: string }) =>
  createDto("Memory", { text: body.text });
export const createProjectCard = (body: { title: string; agentId?: string }) =>
  createDto("TaskCard", { title: body.title });
`
  );
  write(
    "apps/bridge/src/kernel/adapters/content.ts",
    `
function agentId(ctx: OperationContext): string {
  return ctx.agentId ?? "intelligence";
}
`
  );
  write(
    "apps/bridge/src/services/user-productivity.ts",
    `
/** ensureAgentProject — agent Kanban / todo_write ownership */
export function ensureAgentProject() {}
`
  );
  write("docs/FEATURES.md", "Calendar Also available in Chat → Calendar tab.\nBank Connect wallets for you and your agents.\n");
  write("apps/bridge/src/kernel/domains/finance.ts", `export const FINANCE = [{ name: "FinanceConnection" }];`);

  const findings = discoverOwnershipParityFindings(root);
  const ids = new Set(findings.map((f) => f.id));
  assert.ok(ids.has("P0-ctx-agentId"));
  assert.ok(ids.has("P0-tasks-split"));
  assert.ok(ids.has("P0-cal-split"));
  assert.ok(ids.has("P0-knowledge-fallback"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("buildDomainGapMatrix includes core domains", () => {
  const report = buildDomainGapMatrix(process.cwd());
  assert.ok(report.domains.some((d) => d.domain === "productivity.tasks"));
  assert.ok(report.domains.some((d) => d.domain === "kernel.http_context"));
  assert.ok(Array.isArray(report.findings));
  assert.ok(Array.isArray(report.symmetry));
});

test("read/write symmetry flags TaskCard split_brain on real repo", () => {
  const rows = discoverReadWriteSymmetry(process.cwd());
  const tasks = rows.find((r) => r.surface === "TaskCard");
  assert.ok(tasks);
  assert.equal(tasks.verdict, "split_brain");
});
