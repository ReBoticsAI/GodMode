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
        dataPlane: "core-records",
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
    ).toMatchObject({
      id: "example",
      dataPlane: "core-records",
      objectTypes: [{ name: "ExampleItem" }],
    });
  });

  it("defaults dataPlane to domain", () => {
    expect(
      parseGodmodePluginManifest({
        id: "domain-default",
        name: "Domain Default",
        version: "1.0.0",
      }).dataPlane
    ).toBe("domain");
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

  it("parses optional network capability hosts", () => {
    const manifest = parseGodmodePluginManifest({
      id: "net-plugin",
      name: "Net Plugin",
      version: "1.0.0",
      capabilities: { network: { hosts: ["api.example.com", "*.cdn.example.com"] } },
    });
    expect(manifest.capabilities?.network?.hosts).toEqual([
      "api.example.com",
      "*.cdn.example.com",
    ]);

    expect(() =>
      parseGodmodePluginManifest({
        id: "bad-cap",
        name: "Bad",
        version: "1.0.0",
        capabilities: { network: { hosts: "api.example.com" } },
      })
    ).toThrow(/capabilities.network.hosts/);
  });

  it("parses optional tool and record capability names", () => {
    const manifest = parseGodmodePluginManifest({
      id: "cap-plugin",
      name: "Cap Plugin",
      version: "1.0.0",
      capabilities: {
        tools: { names: ["search_docs"] },
        records: { names: ["Invoice", "StructureNode"] },
      },
    });
    expect(manifest.capabilities?.tools?.names).toEqual(["search_docs"]);
    expect(manifest.capabilities?.records?.names).toEqual([
      "Invoice",
      "StructureNode",
    ]);

    const shorthand = parseGodmodePluginManifest({
      id: "cap-shorthand",
      name: "Cap Shorthand",
      version: "1.0.0",
      capabilities: { tools: ["workspace_pulse_ping"] },
    });
    expect(shorthand.capabilities?.tools?.names).toEqual(["workspace_pulse_ping"]);

    expect(() =>
      parseGodmodePluginManifest({
        id: "bad-tools",
        name: "Bad",
        version: "1.0.0",
        capabilities: { tools: { names: "search_docs" } },
      })
    ).toThrow(/capabilities.tools.names/);
  });
});
