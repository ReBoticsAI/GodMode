import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import { withOfficialVerifiedPublisher } from "../marketplace-catalog.js";
import {
  buildPublicOfficialCatalog,
  upsertOfficialCatalogEntry,
} from "../marketplace-official-catalog.js";

vi.mock("../marketplace-catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../marketplace-catalog.js")>();
  return {
    ...actual,
    fetchOfficialCatalog: vi.fn(async () => ({
      url: "https://example.test/catalog/index.json",
      entries: [
        withOfficialVerifiedPublisher({
          id: "default-verified",
          kind: "plugin",
          installType: "plugin" as const,
          title: "Default",
          description: "",
          version: "1.0.0",
          author: "GodMode",
          pluginRepo: "https://github.com/example/default",
          pluginRef: "abc1234",
        }),
        withOfficialVerifiedPublisher({
          id: "explicit-unverified",
          kind: "plugin",
          installType: "plugin" as const,
          title: "Unverified",
          description: "",
          version: "1.0.0",
          author: "Other",
          pluginRepo: "https://github.com/example/other",
          pluginRef: "def5678",
          verifiedPublisher: false,
        }),
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
      verified_publisher INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("verified publisher (#309)", () => {
  it("defaults Official entries to verifiedPublisher true; explicit false wins", () => {
    expect(withOfficialVerifiedPublisher({ id: "a" }).verifiedPublisher).toBe(true);
    expect(
      withOfficialVerifiedPublisher({ id: "b", verifiedPublisher: true }).verifiedPublisher
    ).toBe(true);
    expect(
      withOfficialVerifiedPublisher({ id: "c", verifiedPublisher: false }).verifiedPublisher
    ).toBe(false);
  });

  it("serves verifiedPublisher from Cloud Official rows and fallback feed", async () => {
    const core = openOfficialCatalogDb();
    upsertOfficialCatalogEntry(core, {
      entryId: "cloud-verified",
      title: "Cloud Verified",
      installType: "clone",
      kind: "bundle",
    });
    upsertOfficialCatalogEntry(core, {
      entryId: "cloud-unverified",
      title: "Cloud Unverified",
      installType: "clone",
      kind: "bundle",
      verifiedPublisher: false,
    });

    const curated = await buildPublicOfficialCatalog(core);
    expect(
      curated.entries.find((e) => e.id === "cloud-verified")?.verifiedPublisher
    ).toBe(true);
    expect(
      curated.entries.find((e) => e.id === "cloud-unverified")?.verifiedPublisher
    ).toBe(false);

    const empty = openOfficialCatalogDb();
    const fallback = await buildPublicOfficialCatalog(empty);
    expect(
      fallback.entries.find((e) => e.id === "default-verified")?.verifiedPublisher
    ).toBe(true);
    expect(
      fallback.entries.find((e) => e.id === "explicit-unverified")?.verifiedPublisher
    ).toBe(false);
  });

  it("preserves verified_publisher on upsert when the field is omitted", () => {
    const core = openOfficialCatalogDb();
    upsertOfficialCatalogEntry(core, {
      entryId: "keep-flag",
      title: "Keep",
      installType: "clone",
      verifiedPublisher: false,
    });
    const again = upsertOfficialCatalogEntry(core, {
      entryId: "keep-flag",
      title: "Keep Updated",
      installType: "clone",
    });
    expect(again.verified_publisher).toBe(0);
  });
});
