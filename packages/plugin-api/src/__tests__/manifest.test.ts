import { describe, expect, it } from "vitest";
import { parseGodmodePluginManifest } from "../index.js";

describe("plugin ObjectType manifests", () => {
  it("accepts metadata-only plugins", () => {
    expect(
      parseGodmodePluginManifest({
        id: "example",
        name: "Example",
        version: "1.0.0",
        objectTypes: [
          {
            name: "ExampleItem",
            label: "Example Item",
            storage: { kind: "native" },
            fields: [{ name: "id", label: "Id", fieldType: "Data" }],
          },
        ],
        records: [
          {
            objectType: "ExampleItem",
            data: { id: "example", title: "Example" },
          },
        ],
      })
    ).toMatchObject({ id: "example", objectTypes: [{ name: "ExampleItem" }] });
  });

  it("rejects invalid metadata before registration", () => {
    expect(() =>
      parseGodmodePluginManifest({
        id: "example",
        name: "Example",
        version: "1.0.0",
        objectTypes: [{ name: "bad-name", fields: [] }],
      })
    ).toThrow(/ObjectType|objectTypes/);
  });
});
