import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverKernelSchema,
  discoverMutationRoutes,
  normalizePath,
  patternMatches,
  protocolPatternError,
  routeMatches,
  sourceFile,
  staticText,
  validateProtocolExceptions,
} from "../audit-kernel-lib.mjs";
import { discoverDirectWrites } from "../audit-kernel-direct-writes.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "godmode-kernel-audit-"));
  const write = (relative, source) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    return file;
  };
  return { root, write };
}

test("normalizes dynamic route and caller segments", () => {
  assert.equal(normalizePath("/api/items/:itemId?x=1"), "/api/items/:");
  assert.equal(routeMatches("/api/items/:id/actions/:action", "/api/items/:/actions/approve"), true);
  assert.equal(patternMatches("/api/dm/blobs/:", "/api/dm/blobs/:id"), true);
  assert.equal(patternMatches("/api/dm/blobs/:", "/api/dm/blobs/:id/raw"), false);
});

test("rejects malformed and literal-alternation exception patterns", () => {
  assert.match(protocolPatternError("/api/*/upload"), /literal segments/);
  assert.match(protocolPatternError("/api/dm/(upload|download)"), /literal segments/);
  assert.match(protocolPatternError("/api/dm/:id/typing"), /exactly ':'/);
});

test("rejects stale protocol exceptions that match no discovered route", () => {
  const errors = validateProtocolExceptions(
    [
      {
        id: "stale-upload",
        methods: ["POST"],
        pathPattern: "/api/files/uploads",
        rationale: "Binary transport.",
        delegated: "kernel-delegated",
      },
    ],
    [{ method: "POST", fullPath: "/api/dm/uploads" }]
  );
  assert.deepEqual(errors, [
    "Stale protocol exception stale-upload: matches no route",
  ]);
});

test("resolves constants inside template paths", () => {
  const { root, write } = fixture();
  const file = write("template.ts", 'const API = "/api"; const value = `${API}/items/${id}`;');
  const source = sourceFile(file);
  const declaration = source.statements[1].declarationList.declarations[0];
  const constants = new Map([
    ["API", source.statements[0].declarationList.declarations[0].initializer],
  ]);
  assert.equal(staticText(declaration.initializer, constants), "/api/items/:param");
  fs.rmSync(root, { recursive: true, force: true });
});

test("discovers recursively mounted router mutations", () => {
  const { root, write } = fixture();
  write(
    "apps/bridge/src/bootstrap.ts",
    'import { createParentRouter } from "./routes/parent.js";\napp.use("/api", createParentRouter());'
  );
  write(
    "apps/bridge/src/routes/parent.ts",
    [
      'import { Router } from "express";',
      'import { createNestedRouter } from "./nested/items.js";',
      "export function createParentRouter() {",
      "  const router = Router();",
      '  router.use("/nested", createNestedRouter());',
      "  return router;",
      "}",
    ].join("\n")
  );
  write(
    "apps/bridge/src/routes/nested/items.ts",
    'import { Router } from "express";\nexport function createNestedRouter() { const router = Router(); router.post("/items/:id", handler); return router; }'
  );
  const result = discoverMutationRoutes(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.routes.map(({ method, fullPath }) => ({ method, fullPath })),
    [{ method: "POST", fullPath: "/api/nested/items/:" }]
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("discovers ObjectTypes generated from registration maps", () => {
  const { root, write } = fixture();
  write(
    "apps/bridge/src/kernel/adapters/generated.ts",
    [
      'const DYNAMIC_ACTIONS = [{ name: "refresh" }, { name: "archive" }];',
      "export const registrationsByName = {",
      "  dynamic: {",
      '    objectType: "DynamicThing",',
      '    adapterId: "dynamic_thing",',
      '    operations: ["list", "get", "create"],',
      "    actions: DYNAMIC_ACTIONS,",
      '    fields: ["id", "title"],',
      "  },",
      "};",
    ].join("\n")
  );
  write(
    "apps/bridge/src/kernel/domains/generated.ts",
    [
      'import { registrationsByName } from "../adapters/generated.js";',
      "export const GENERATED_SPECS = Object.values(registrationsByName).map((registration) => ({",
      "  name: registration.objectType,",
      '  module: "runtime",',
      "  id: registration.adapterId,",
      "  operations: [...registration.operations],",
      "  actions: [...registration.actions],",
      "  fields: registration.fields.map((field) => field),",
      "}));",
    ].join("\n")
  );
  write("packages/kernel/src/builtins.ts", "");

  const schema = discoverKernelSchema(root);
  assert.deepEqual([...schema.get("DynamicThing").operations], ["list", "get", "create"]);
  assert.deepEqual([...schema.get("DynamicThing").actions], ["refresh", "archive"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("detects SQL and filesystem writes but not reads", () => {
  const { root, write } = fixture();
  const file = write(
    "entry.ts",
    [
      'db.prepare("SELECT * FROM records").all();',
      'db.prepare("INSERT INTO records (id) VALUES (?)").run(id);',
      'fs.writeFileSync("state.json", "{}");',
    ].join("\n")
  );
  const writes = discoverDirectWrites(root, [file]);
  assert.deepEqual(
    writes.map(({ kind, operation }) => ({ kind, operation })),
    [
      { kind: "sql", operation: "INSERT" },
      { kind: "filesystem", operation: "writeFileSync" },
    ]
  );
  fs.rmSync(root, { recursive: true, force: true });
});
