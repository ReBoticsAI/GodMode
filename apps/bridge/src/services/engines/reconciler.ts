import type { EventEmitter } from "node:events";
import type { EngineRegistry } from "./registry.js";

export interface StructureDepartmentEvent {
  departmentId: string;
  label?: string;
  icon?: string;
}

export interface StructureDivisionEvent {
  departmentId: string;
  divisionId: string;
}

export interface StructurePageEvent {
  departmentId: string;
  divisionId: string;
  pageId: string;
}

/**
 * Subscribes to structure bus events and runs engine provisioning, then
 * broadcasts `structure_changed` for the web UI.
 */
export class EngineReconciler {
  constructor(
    private readonly bus: EventEmitter,
    private readonly registry: EngineRegistry
  ) {
    this.bus.on(
      "structure.department.created",
      (payload: StructureDepartmentEvent) => {
        this.onDepartmentCreated(payload);
      }
    );
    this.bus.on(
      "structure.department.updated",
      (payload: StructureDepartmentEvent) => {
        this.registry.reconcileDepartment(payload.departmentId);
        this.emitStructureChanged("department", "updated", payload.departmentId);
      }
    );
    this.bus.on(
      "structure.department.deleted",
      (payload: StructureDepartmentEvent) => {
        this.onDepartmentDeleted(payload);
      }
    );
    // Divisions provision a subagent that reports to the department agent.
    this.bus.on("structure.division.created", (p: StructureDivisionEvent) => {
      this.registry.reconcileDivision(p.departmentId, p.divisionId);
      this.emitStructureChanged("division", "created", p.divisionId);
    });
    this.bus.on("structure.division.updated", (p: StructureDivisionEvent) => {
      this.registry.reconcileDivision(p.departmentId, p.divisionId);
      this.emitStructureChanged("division", "updated", p.divisionId);
    });
    this.bus.on("structure.division.deleted", (p: StructureDivisionEvent) => {
      this.registry.disableDivision(p.departmentId, p.divisionId);
      this.emitStructureChanged("division", "deleted", p.divisionId);
    });
    // Pages provision a Worker subagent that reports to the division agent.
    this.bus.on("structure.page.created", (p: StructurePageEvent) => {
      this.registry.reconcilePage(p.departmentId, p.divisionId, p.pageId);
      this.emitStructureChanged("page", "created", p.pageId);
    });
    this.bus.on("structure.page.updated", (p: StructurePageEvent) => {
      this.registry.reconcilePage(p.departmentId, p.divisionId, p.pageId);
      this.emitStructureChanged("page", "updated", p.pageId);
    });
    this.bus.on("structure.page.deleted", (p: StructurePageEvent) => {
      this.registry.disablePage(p.departmentId, p.divisionId, p.pageId);
      this.emitStructureChanged("page", "deleted", p.pageId);
    });
    this.bus.on("structure.reordered", (p: { kind: string }) =>
      this.emitStructureChanged(p.kind ?? "structure", "reordered", "")
    );
    for (const action of ["created", "updated", "deleted"] as const) {
      this.bus.on(
        `structure.node.${action}`,
        (payload: { nodeId: string }) => {
          this.registry.reconcileAll();
          this.emitStructureChanged("node", action, payload.nodeId);
        }
      );
    }
  }

  private onDepartmentDeleted(payload: StructureDepartmentEvent): void {
    this.registry.disableDepartment(payload.departmentId);
    this.emitStructureChanged("department", "deleted", payload.departmentId);
  }

  private onDepartmentCreated(payload: StructureDepartmentEvent): void {
    const row =
      payload.label != null && payload.icon != null
        ? { label: payload.label, icon: payload.icon }
        : undefined;
    this.registry.reconcileDepartment(payload.departmentId, row);
    this.emitStructureChanged("department", "created", payload.departmentId);
  }

  private emitStructureChanged(
    entity: string,
    action: string,
    id: string
  ): void {
    this.bus.emit("structure_changed", { entity, action, id, at: Date.now() });
  }
}
