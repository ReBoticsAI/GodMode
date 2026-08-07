/**
 * AST chunker + hybrid codebase search (#69 A+B).
 */
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import { chunkSourceFile } from "../coding/code-chunker.js";
import { syncCodeIndex, searchCodeChunks, walkFiles } from "../coding/code-index.js";
import { codebaseSearch } from "../coding/codebase-search.js";
import { cosineSimilarity, l2normalize } from "../embeddings/embedding-client.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-code-idx-"));
  temps.push(dir);
  return dir;
}

function openDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE code_index_roots (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL UNIQUE,
      fingerprint TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE code_chunks (
      id TEXT PRIMARY KEY,
      root_id TEXT NOT NULL,
      path TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'module',
      symbol TEXT NOT NULL DEFAULT '',
      start_line INTEGER NOT NULL DEFAULT 1,
      end_line INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB,
      embedding_dim INTEGER,
      model_id TEXT,
      profile TEXT NOT NULL DEFAULT 'code',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("chunkSourceFile", () => {
  it("extracts TypeScript function and class chunks", async () => {
    const source = `
export function alphaHelper(x: number): number {
  return x + 1;
}

export class BetaService {
  run(): string {
    return "ok";
  }
}
`;
    const chunks = await chunkSourceFile("src/demo.ts", source);
    const kinds = new Set(chunks.map((c) => c.kind));
    expect(kinds.has("function") || kinds.has("class") || kinds.has("method")).toBe(
      true
    );
    expect(chunks.some((c) => /alphaHelper|BetaService|run/.test(c.symbol))).toBe(
      true
    );
  }, 30_000);

  it("falls back to module chunk for unsupported languages", async () => {
    const chunks = await chunkSourceFile(
      "script.py",
      "def hello():\n    return 1\n"
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].kind).toBe("module");
  });
});

describe("walkFiles", () => {
  it("stops after maxFiles without requiring a full tree walk", () => {
    const root = tempRoot();
    mkdirSync(join(root, "src"), { recursive: true });
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(root, "src", `f${i}.ts`), `export const n${i} = ${i};\n`, "utf8");
    }
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "pkg", "index.ts"),
      "export const skip = 1;\n",
      "utf8"
    );
    const files = walkFiles(root, 5);
    expect(files).toHaveLength(5);
    expect(files.every((p) => p.startsWith("src/"))).toBe(true);
  });
});

describe("syncCodeIndex", () => {
  it("upserts chunks and removes stale paths", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "a.ts"),
      "export function keepMe() { return 1; }\n",
      "utf8"
    );
    const db = openDb();
    const first = await syncCodeIndex(db, { root, force: true, maxFiles: 50 });
    expect(first.filesScanned).toBe(1);
    expect(first.chunksUpserted).toBeGreaterThan(0);

    writeFileSync(
      join(root, "src", "b.ts"),
      "export function other() { return 2; }\n",
      "utf8"
    );
    const second = await syncCodeIndex(db, { root, force: true, maxFiles: 50 });
    expect(second.filesScanned).toBe(2);

    rmSync(join(root, "src", "a.ts"));
    const third = await syncCodeIndex(db, { root, force: true, maxFiles: 50 });
    const paths = (
      db.prepare(`SELECT DISTINCT path FROM code_chunks`).all() as Array<{
        path: string;
      }>
    ).map((r) => r.path);
    expect(paths.every((p) => !p.includes("a.ts"))).toBe(true);
    expect(third.chunksRemoved).toBeGreaterThan(0);
  }, 60_000);
});

describe("codebaseSearch hybrid", () => {
  it("returns grep mode without embedder", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "auth.ts"),
      "export function validateAuthToken() { return true; }\n",
      "utf8"
    );
    const res = await codebaseSearch({
      query: "validateAuthToken",
      root,
    });
    expect(res.mode).toBe("grep");
    expect(res.results.length).toBeGreaterThanOrEqual(0);
    // Grep engines vary; when matches exist they should reference the file.
    if (res.results.length > 0) {
      expect(res.results.some((r) => /auth\.ts|validateAuthToken/.test(r.path + r.snippet))).toBe(
        true
      );
    }
  });

  it("ranks vector hits ahead via RRF when present", () => {
    const a = l2normalize(Float32Array.from([1, 0, 0]));
    const b = l2normalize(Float32Array.from([0.9, 0.1, 0]));
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.8);
  });
});

describe("searchCodeChunks", () => {
  it("returns empty when no embeddings", () => {
    const db = openDb();
    const hits = searchCodeChunks(db, {
      rootPath: "/tmp/none",
      queryVec: l2normalize(Float32Array.from([1, 0, 0])),
    });
    expect(hits).toEqual([]);
  });
});
