import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { EngineReconciler } from "../engines/reconciler.js";

describe("EngineReconciler structure_changed tenantId (#667)", () => {
  it("forwards tenantId from structure.node.* onto structure_changed", () => {
    const bus = new EventEmitter();
    const registry = {
      reconcileAll: vi.fn(),
      reconcileDepartment: vi.fn(),
      disableDepartment: vi.fn(),
      reconcileDivision: vi.fn(),
      disableDivision: vi.fn(),
      reconcilePage: vi.fn(),
      disablePage: vi.fn(),
    };
    new EngineReconciler(bus, registry as never);

    const seen: Array<Record<string, unknown>> = [];
    bus.on("structure_changed", (payload) => seen.push(payload));

    bus.emit("structure.node.created", {
      nodeId: "dept-recipe-box",
      tenantId: "tenant-saas-1",
    });

    expect(registry.reconcileAll).toHaveBeenCalledOnce();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      entity: "node",
      action: "created",
      id: "dept-recipe-box",
      tenantId: "tenant-saas-1",
    });
    expect(typeof seen[0]!.at).toBe("number");
  });

  it("omits tenantId when structure.node.* payload has none", () => {
    const bus = new EventEmitter();
    const registry = { reconcileAll: vi.fn() };
    new EngineReconciler(bus, {
      ...registry,
      reconcileDepartment: vi.fn(),
      disableDepartment: vi.fn(),
      reconcileDivision: vi.fn(),
      disableDivision: vi.fn(),
      reconcilePage: vi.fn(),
      disablePage: vi.fn(),
    } as never);

    const seen: Array<Record<string, unknown>> = [];
    bus.on("structure_changed", (payload) => seen.push(payload));

    bus.emit("structure.node.updated", { nodeId: "n1" });

    expect(seen[0]).toMatchObject({
      entity: "node",
      action: "updated",
      id: "n1",
    });
    expect(seen[0]).not.toHaveProperty("tenantId");
  });
});
