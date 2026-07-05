import type { AppDatabase } from "../../db.js";
import { EngineRegistry } from "../engines/registry.js";

/** @deprecated Prefer `EngineRegistry.reconcileAll()` directly. */
export function seedDepartmentAgents(db: AppDatabase): void {
  new EngineRegistry(db).reconcileAll();
}
