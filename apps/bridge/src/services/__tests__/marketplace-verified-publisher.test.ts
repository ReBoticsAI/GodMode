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
      url: "https://example.test/catalog/official/index.json",
      entries: [
        withOfficialVerifiedPublisher({
          id: "default-unverified",
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
          id: "explicit-verified",
          kind: "plugin",
          installType: "plugin" as const,
          title: "Verified",
          description: "",
          version: "1.0.0",
          author: "GodMode",
          pluginRepo: "https://github.com/example/other",
          pluginRef: "def5678",
          verifiedPublisher: true,
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
      verified_publisher INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("Official verified publisher (#315)", () => {
  it("does not default Official entries to verified; explicit true wins", () => {
    expect(withOfficialVerifiedPublisher({ id: "a" }).verifiedPublisher).toBe(false);
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
      entryId: "cloud-default",
      title: "Cloud Default",
      installType: "clone",
      kind: "bundle",
    });
    upsertOfficialCatalogEntry(core, {
      entryId: "cloud-verified",
      title: "Cloud Verified",
      installType: "clone",
      kind: "bundle",
      verifiedPublisher: true,
    });

    const curated = await buildPublicOfficialCatalog(core);
    expect(
      curated.entries.find((e) => e.id === "cloud-default")?.verifiedPublisher
    ).toBe(false);
    expect(
      curated.entries.find((e) => e.id === "cloud-verified")?.verifiedPublisher
    ).toBe(true);

    const empty = openOfficialCatalogDb();
    const fallback = await buildPublicOfficialCatalog(empty);
    expect(
      fallback.entries.find((e) => e.id === "default-unverified")?.verifiedPublisher
    ).toBe(false);
    expect(
      fallback.entries.find((e) => e.id === "explicit-verified")?.verifiedPublisher
    ).toBe(true);
  });

  it("preserves verified_publisher on upsert when the field is omitted", () => {
    const core = openOfficialCatalogDb();
    upsertOfficialCatalogEntry(core, {
      entryId: "keep-flag",
      title: "Keep",
      installType: "clone",
      verifiedPublisher: true,
    });
    const again = upsertOfficialCatalogEntry(core, {
      entryId: "keep-flag",
      title: "Keep Updated",
      installType: "clone",
    });
    expect(again.verified_publisher).toBe(1);
  });
});
