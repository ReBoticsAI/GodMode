import Database from "better-sqlite3";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerCoreObjectTypes } from "../core-object-types.js";
import { importEntity, type PortableBundle } from "../../services/portability.js";

describe("portable ObjectType Records", () => {
  let db: Database.Database;

  beforeAll(() => registerCoreObjectTypes());

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE structure_nodes (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        label TEXT NOT NULL,
        icon TEXT NOT NULL,
        segment TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'placeholder',
        object_type TEXT,
        right_sidebar TEXT,
        agent_id TEXT,
        built_in INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        tabs_json TEXT
      );
    `);
  });

  it("imports migrated Record-bundle children through kernel dispatch", () => {
    const bundle: PortableBundle = {
      version: 1,
      kind: "bundle",
      exportedAt: "2026-07-14T00:00:00.000Z",
      sourceId: "work-starter-pack",
      title: "Work starter pack",
      data: {
        children: [
          {
            version: 1,
            kind: "record",
            exportedAt: "2026-07-14T00:00:00.000Z",
            sourceId: "work",
            title: "Work",
            data: {
              record: {
                id: "work",
                objectType: "StructureNode",
                data: {
                  id: "work",
                  parent_id: null,
                  label: "Work",
                  icon: "briefcase",
                  segment: "work",
                  kind: "placeholder",
                },
              },
            },
          },
        ],
      },
    };

    expect(importEntity(db, bundle)).toEqual({ kind: "bundle", newId: "work" });
    expect(
      db.prepare(`SELECT id, label, segment FROM structure_nodes WHERE id='work'`).get()
    ).toEqual({ id: "work", label: "Work", segment: "work" });
  });

  it("rejects unsupported ObjectTypes and mismatched deterministic ids", () => {
    const portableRecord = (objectType: string, dataId = "safe") =>
      ({
        version: 1,
        kind: "record",
        exportedAt: "2026-07-14T00:00:00.000Z",
        sourceId: "safe",
        title: "Unsafe",
        data: {
          record: {
            id: "safe",
            objectType,
            data: { id: dataId },
          },
        },
      }) as PortableBundle;

    expect(() => importEntity(db, portableRecord("VaultSecret"))).toThrow(
      /unsupported portable Record/i
    );
    expect(() =>
      importEntity(db, portableRecord("StructureNode", "different"))
    ).toThrow(/id must match/i);
  });
});
