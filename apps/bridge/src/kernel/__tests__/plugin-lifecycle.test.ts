import { describe, expect, it } from "vitest";
import type { ObjectTypeDef } from "@godmode/kernel";
import {
  getObjectType,
  registerObjectType,
  replaceObjectTypesByPlugin,
  unregisterObjectTypesByPlugin,
} from "../registry.js";

function pluginDef(name: string, pluginId: string): ObjectTypeDef {
  return {
    name,
    label: name,
    pluginId,
    storage: { kind: "native" },
    operations: ["list", "get", "create", "update", "delete"],
    fields: [{ name: "id", label: "Id", fieldType: "Data" }],
  };
}

describe("plugin ObjectType lifecycle", () => {
  it("atomically replaces removed definitions and supports uninstall", () => {
    replaceObjectTypesByPlugin("lifecycle-test", [
      pluginDef("LifecycleOld", "lifecycle-test"),
    ]);
    replaceObjectTypesByPlugin("lifecycle-test", [
      pluginDef("LifecycleNew", "lifecycle-test"),
    ]);
    expect(getObjectType("LifecycleOld")).toBeUndefined();
    expect(getObjectType("LifecycleNew")?.pluginId).toBe("lifecycle-test");
    unregisterObjectTypesByPlugin("lifecycle-test");
    expect(getObjectType("LifecycleNew")).toBeUndefined();
  });

  it("cannot replace another plugin or core owner", () => {
    registerObjectType(pluginDef("OwnedLifecycle", "owner-a"));
    expect(() =>
      replaceObjectTypesByPlugin("owner-b", [
        pluginDef("OwnedLifecycle", "owner-b"),
      ])
    ).toThrow(/owned by owner-a/);
    unregisterObjectTypesByPlugin("owner-a");
  });
});
