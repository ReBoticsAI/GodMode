import { describe, expect, it } from "vitest";
import {
  parseGodmodePluginManifest,
  type GodmodePluginManifest,
} from "@godmode/plugin-api";
import { applyPluginObjectTypeSeeds } from "../../kernel/plugin-object-types.js";
import { assertPluginDataPlane } from "../plugin-data-plane.js";
import { isPluginLoopError } from "../plugin-loop-error.js";
import Database from "better-sqlite3";

const nativeOt = {
  name: "JournalEntry",
  label: "Journal Entry",
  storage: { kind: "native" as const, tableName: "journal_entries" },
  fields: [
    { name: "id", label: "Id", fieldType: "Data" as const, required: true },
    { name: "title", label: "Title", fieldType: "Data" as const },
  ],
};

describe("plugin data plane (#629)", () => {
  it("defaults omitted dataPlane to domain", () => {
    const manifest = parseGodmodePluginManifest({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
    });
    expect(manifest.dataPlane).toBe("domain");
  });

  it("parses core-records", () => {
    const manifest = parseGodmodePluginManifest({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      dataPlane: "core-records",
    });
    expect(manifest.dataPlane).toBe("core-records");
  });

  it("rejects invalid dataPlane", () => {
    expect(() =>
      parseGodmodePluginManifest({
        id: "demo",
        name: "Demo",
        version: "1.0.0",
        dataPlane: "tenant",
      })
    ).toThrow(/dataPlane/);
  });

  it("rejects native ObjectTypes when dataPlane is domain", () => {
    const manifest = parseGodmodePluginManifest({
      id: "quotes-like",
      name: "Quotes Like",
      version: "1.0.0",
      objectTypes: [nativeOt],
    });
    expect(manifest.dataPlane).toBe("domain");
    expect(() => assertPluginDataPlane(manifest)).toThrow(/openPluginDb|core-records/);
    try {
      assertPluginDataPlane(manifest);
    } catch (err) {
      expect(isPluginLoopError(err)).toBe(true);
      if (isPluginLoopError(err)) expect(err.failureClass).toBe("manifest");
    }
  });

  it("allows native ObjectTypes when dataPlane is core-records", () => {
    const manifest = parseGodmodePluginManifest({
      id: "notes-core",
      name: "Notes Core",
      version: "1.0.0",
      dataPlane: "core-records",
      objectTypes: [nativeOt],
    });
    expect(() => assertPluginDataPlane(manifest)).not.toThrow();
  });

  it("applyPluginObjectTypeSeeds fails closed for domain + native", () => {
    const db = new Database(":memory:");
    const manifest = parseGodmodePluginManifest({
      id: "bad-seed",
      name: "Bad Seed",
      version: "1.0.0",
      objectTypes: [nativeOt],
    }) as GodmodePluginManifest;
    expect(() => applyPluginObjectTypeSeeds(db as never, manifest)).toThrow(
      /core-records|openPluginDb/
    );
  });
});
