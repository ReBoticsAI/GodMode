/**
 * Wiki Cloud → Workspace one-shot migrate (#512).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import {
  ensureWikiWorkspaceSchema,
  migrateWikiFromCloud,
  WIKI_MOVED_META_KEY,
} from "../wiki-workspace-migrate.js";

function openTempDb(filePath: string): Database.Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return new Database(filePath);
}

/** Minimal Cloud wiki DDL (migrate source; mirrors core-db tables). */
function ensureCloudWikiSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_pages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      space TEXT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'internal'
        CHECK (visibility IN ('internal', 'external')),
      author_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS wiki_revisions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      author_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS wiki_page_proposals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('create', 'update')),
      space TEXT,
      slug TEXT,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      target_page_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'synthesize',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts USING fts5(
      page_id UNINDEXED,
      title,
      body
    );
  `);
}

describe("migrateWikiFromCloud", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("copies tenant wiki rows to Workspace, deletes from Cloud, and is idempotent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gm-wiki-migrate-"));
    dirs.push(root);
    const cloudPath = path.join(root, "Cloud.sqlite");
    const tenantPath = path.join(root, "tenants", "t1.sqlite");

    const cloud = openTempDb(cloudPath) as CoreDatabase;
    const tenantDb = openTempDb(tenantPath);
    ensureCloudWikiSchema(cloud);
    ensureWikiWorkspaceSchema(tenantDb);

    const tenantId = "tenant-a";
    const pageId = "page-1";
    cloud
      .prepare(
        `INSERT INTO wiki_pages
           (id, tenant_id, space, slug, title, body_markdown, visibility, author_user_id)
         VALUES (?, ?, 'onboarding', 'welcome', 'Welcome', 'hello', 'internal', 'user-1')`
      )
      .run(pageId, tenantId);
    cloud
      .prepare(
        `INSERT INTO wiki_revisions (id, page_id, title, body_markdown, author_user_id)
         VALUES ('rev-1', ?, 'Welcome', 'hello', 'user-1')`
      )
      .run(pageId);
    cloud
      .prepare(
        `INSERT INTO wiki_page_proposals
           (id, tenant_id, action, title, body_markdown, status, source)
         VALUES ('prop-1', ?, 'create', 'Draft', 'body', 'pending', 'test')`
      )
      .run(tenantId);

    migrateWikiFromCloud(tenantId, tenantDb, cloud);

    const onTenant = tenantDb
      .prepare(`SELECT id, title FROM wiki_pages WHERE tenant_id = ?`)
      .get(tenantId) as { id: string; title: string } | undefined;
    expect(onTenant).toEqual({ id: pageId, title: "Welcome" });
    expect(
      (
        tenantDb
          .prepare(`SELECT COUNT(*) AS n FROM wiki_revisions WHERE page_id = ?`)
          .get(pageId) as { n: number }
      ).n
    ).toBe(1);
    expect(
      (
        tenantDb
          .prepare(
            `SELECT COUNT(*) AS n FROM wiki_page_proposals WHERE tenant_id = ?`
          )
          .get(tenantId) as { n: number }
      ).n
    ).toBe(1);

    expect(
      (
        cloud
          .prepare(`SELECT COUNT(*) AS n FROM wiki_pages WHERE tenant_id = ?`)
          .get(tenantId) as { n: number }
      ).n
    ).toBe(0);
    expect(
      (
        cloud
          .prepare(`SELECT COUNT(*) AS n FROM wiki_revisions WHERE page_id = ?`)
          .get(pageId) as { n: number }
      ).n
    ).toBe(0);
    expect(
      (
        cloud
          .prepare(
            `SELECT COUNT(*) AS n FROM wiki_page_proposals WHERE tenant_id = ?`
          )
          .get(tenantId) as { n: number }
      ).n
    ).toBe(0);

    const meta = tenantDb
      .prepare(`SELECT value FROM wiki_plane_meta WHERE key = ?`)
      .get(WIKI_MOVED_META_KEY) as { value: string } | undefined;
    expect(meta?.value).toBe("1");

    // Second migrate must be a no-op (idempotent).
    cloud
      .prepare(
        `INSERT INTO wiki_pages
           (id, tenant_id, space, slug, title, body_markdown, visibility, author_user_id)
         VALUES ('page-cloud-only', ?, NULL, 'should-not-copy', 'Nope', '', 'internal', 'user-1')`
      )
      .run(tenantId);
    migrateWikiFromCloud(tenantId, tenantDb, cloud);
    expect(
      (
        tenantDb
          .prepare(`SELECT COUNT(*) AS n FROM wiki_pages WHERE id = 'page-cloud-only'`)
          .get() as { n: number }
      ).n
    ).toBe(0);
    expect(
      (
        tenantDb
          .prepare(`SELECT COUNT(*) AS n FROM wiki_pages WHERE tenant_id = ?`)
          .get(tenantId) as { n: number }
      ).n
    ).toBe(1);

    cloud.close();
    tenantDb.close();
  });
});
