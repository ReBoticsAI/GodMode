import { describe, expect, it } from "vitest";
import {
  KERNEL_CLIENT_API_VERSION,
  parseGodmodePluginManifest,
} from "../index.js";

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

  it("negotiates the versioned kernel client contract", () => {
    const manifest = parseGodmodePluginManifest({
      id: "kernel-plugin",
      name: "Kernel Plugin",
      version: "1.0.0",
      kernelApiVersion: KERNEL_CLIENT_API_VERSION,
    });
    expect(manifest.kernelApiVersion).toBe(KERNEL_CLIENT_API_VERSION);

    expect(() =>
      parseGodmodePluginManifest({
        id: "future-plugin",
        name: "Future Plugin",
        version: "1.0.0",
        kernelApiVersion: KERNEL_CLIENT_API_VERSION + 1,
      })
    ).toThrow(/unsupported kernelApiVersion/);
  });
});
