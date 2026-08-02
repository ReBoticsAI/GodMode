import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import {
  assertOfficialCatalogPluginPinForUpsert,
  auditOfficialCatalogPluginPins,
  buildPublicOfficialCatalog,
  listOfficialCatalogRows,
  syncOfficialCatalogFromPublicFeed,
  upsertOfficialCatalogEntry,
  type OfficialCatalogRow,
} from "../marketplace-official-catalog.js";
import { assertPluginInstallPin } from "../marketplace-plugin-pin.js";

vi.mock("../marketplace-catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../marketplace-catalog.js")>();
  return {
    ...actual,
    fetchOfficialCatalog: vi.fn(async () => ({
      url: "https://example.test/catalog/index.json",
      entries: [
        {
          id: "godmode-plugin-git",
          kind: "plugin",
          installType: "plugin" as const,
          title: "Git",
          description: "git tools",
          version: "0.1.0",
          author: "GodMode",
          pluginRepo: "https://github.com/ReBoticsAI/godmode-plugin-git",
          pluginRef: "b10fd98ff315262cfc815e1f6d90ae2f23489e02",
          pluginDigest: "b10fd98ff315262cfc815e1f6d90ae2f23489e02",
        },
        {
          id: "floating-plugin",
          kind: "plugin",
          installType: "plugin" as const,
          title: "Bad",
          description: "",
          version: "0.0.1",
          author: "x",
          pluginRepo: "https://github.com/example/bad",
          pluginRef: "main",
        },
        {
          id: "research-agent-pack",
          kind: "bundle",
          installType: "clone" as const,
          title: "Research Agent Pack",
          description: "pack",
          version: "1.1.0",
          author: "GodMode",
          bundlePath: "packs/research-agent-pack/bundle.json",
        },
      ],
    })),
  };
});

function openOfficialCatalogDb(): CoreDatabase {
  const db = new Database(":memory:") as unknown as CoreDatabase;
  db.exec(`
    CREATE TABLE marketplace_official_catalog (
      entry_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      version TEXT,
      author TEXT,
      kind TEXT,
      install_type TEXT NOT NULL,
      tags_json TEXT,
      bundle_path TEXT,
      plugin_repo TEXT,
      plugin_ref TEXT,
      plugin_digest TEXT,
      preview_path TEXT,
      price_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      listing_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("marketplace-official-catalog pins (#292)", () => {
  it("fail-closes active plugin upserts without an immutable pluginRef", () => {
    expect(() =>
      assertOfficialCatalogPluginPinForUpsert({
        entryId: "demo",
        title: "Demo",
        installType: "plugin",
        pluginRef: "main",
      })
    ).toThrow(/pinned pluginRef/);

    expect(() =>
      assertOfficialCatalogPluginPinForUpsert({
        entryId: "demo",
        title: "Demo",
        installType: "plugin",
        status: "inactive",
        pluginRef: "main",
      })
    ).not.toThrow();

    expect(() =>
      assertOfficialCatalogPluginPinForUpsert({
        entryId: "pack",
        title: "Pack",
        installType: "clone",
      })
    ).not.toThrow();
  });

  it("audits floating and missing active plugin pins", () => {
    const rows: OfficialCatalogRow[] = [
      {
        entry_id: "a",
        title: "A",
        description: null,
        version: null,
        author: null,
        kind: "plugin",
        install_type: "plugin",
        tags_json: null,
        bundle_path: null,
        plugin_repo: "https://github.com/example/a",
        plugin_ref: "main",
        plugin_digest: null,
        preview_path: null,
        price_cents: 0,
        currency: "usd",
        listing_id: null,
        status: "active",
        sort_order: 0,
        updated_at: "now",
      },
      {
        entry_id: "b",
        title: "B",
        description: null,
        version: null,
        author: null,
        kind: "plugin",
        install_type: "plugin",
        tags_json: null,
        bundle_path: null,
        plugin_repo: "https://github.com/example/b",
        plugin_ref: "abcdef0123456789",
        plugin_digest: "not-a-sha",
        preview_path: null,
        price_cents: 0,
        currency: "usd",
        listing_id: null,
        status: "active",
        sort_order: 1,
        updated_at: "now",
      },
    ];
    const issues = auditOfficialCatalogPluginPins(rows);
    expect(issues.map((i) => i.issue)).toEqual(["floating_ref", "invalid_digest"]);
  });

  it("stores pluginDigest and serves it on the public Official feed", async () => {
    const db = openOfficialCatalogDb();
    const row = upsertOfficialCatalogEntry(db, {
      entryId: "godmode-plugin-git",
      title: "Git",
      installType: "plugin",
      pluginRepo: "https://github.com/ReBoticsAI/godmode-plugin-git",
      pluginRef: "b10fd98ff315262cfc815e1f6d90ae2f23489e02",
      pluginDigest: "b10fd98ff315262cfc815e1f6d90ae2f23489e02",
      priceCents: 0,
    });
    expect(row.plugin_digest).toBe("b10fd98ff315262cfc815e1f6d90ae2f23489e02");

    const catalog = await buildPublicOfficialCatalog(db);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]?.pluginRef).toBe(
      "b10fd98ff315262cfc815e1f6d90ae2f23489e02"
    );
    expect(catalog.entries[0]?.pluginDigest).toBe(
      "b10fd98ff315262cfc815e1f6d90ae2f23489e02"
    );
    expect(
      assertPluginInstallPin(
        { ...catalog.entries[0]!, sourceName: "Official" },
        "required"
      )
    ).toEqual({
      ref: "b10fd98ff315262cfc815e1f6d90ae2f23489e02",
      digest: "b10fd98ff315262cfc815e1f6d90ae2f23489e02",
    });
  });

  it("syncs pinned public feed rows and preserves Cloud prices", async () => {
    const db = openOfficialCatalogDb();
    upsertOfficialCatalogEntry(db, {
      entryId: "godmode-plugin-git",
      title: "Git (priced)",
      installType: "plugin",
      pluginRepo: "https://github.com/ReBoticsAI/godmode-plugin-git",
      pluginRef: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      pluginDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      priceCents: 999,
      listingId: "listing-git",
      sortOrder: 7,
    });

    const result = await syncOfficialCatalogFromPublicFeed(db);
    expect(result.upserted).toContain("godmode-plugin-git");
    expect(result.upserted).toContain("research-agent-pack");
    expect(result.skipped).toEqual([
      {
        id: "floating-plugin",
        reason: "floating or missing pluginRef (fail closed for Official plugins)",
      },
    ]);
    expect(result.pinAudit).toEqual([]);

    const git = listOfficialCatalogRows(db).find((r) => r.entry_id === "godmode-plugin-git");
    expect(git?.price_cents).toBe(999);
    expect(git?.listing_id).toBe("listing-git");
    expect(git?.sort_order).toBe(7);
    expect(git?.plugin_ref).toBe("b10fd98ff315262cfc815e1f6d90ae2f23489e02");
    expect(git?.plugin_digest).toBe("b10fd98ff315262cfc815e1f6d90ae2f23489e02");
  });
});
