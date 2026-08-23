import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  emitKernelStructureChanged,
  setKernelEventBus,
} from "../../kernel/adapter-registry.js";

describe("emitKernelStructureChanged (#657)", () => {
  afterEach(() => {
    setKernelEventBus(undefined);
  });

  it("no-ops when the process bus is unset", () => {
    expect(() =>
      emitKernelStructureChanged({
        entity: "plugin",
        action: "installed",
        id: "plant-care",
        tenantId: "t1",
      })
    ).not.toThrow();
  });

  it("emits structure_changed with entity, action, id, tenantId, and at", () => {
    const bus = new EventEmitter();
    const seen: unknown[] = [];
    bus.on("structure_changed", (payload) => seen.push(payload));
    setKernelEventBus(bus);

    emitKernelStructureChanged({
      entity: "plugin",
      action: "installed",
      id: "plant-care",
      tenantId: "tenant-a",
    });
    emitKernelStructureChanged({
      entity: "plugin",
      action: "uninstalled",
      id: "plant-care",
      tenantId: "tenant-a",
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      entity: "plugin",
      action: "installed",
      id: "plant-care",
      tenantId: "tenant-a",
    });
    expect(typeof (seen[0] as { at: number }).at).toBe("number");
    expect(seen[1]).toMatchObject({
      entity: "plugin",
      action: "uninstalled",
      id: "plant-care",
      tenantId: "tenant-a",
    });
  });
});
