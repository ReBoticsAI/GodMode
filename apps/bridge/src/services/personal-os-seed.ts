import type { AppDatabase } from "../db.js";
import fs from "node:fs";
import { tenantWorkspaceDir } from "../config.js";
import { updateAgent } from "./agents/agents-db.js";
import { personalIntelligenceToolNames } from "./ai-tools-registry.js";
import { writeTenantKind } from "./tenant-kind.js";
import {
  syncPersonalBootstrapKnowledge,
  repairPersonalTenantDefaults,
} from "./knowledge-store.js";

/**
 * Personal-OS bootstrap for new user workspaces (not operator Trading plugins).
 * Structure tree is intentionally empty — users create departments via Intelligence.
 */
export function seedPersonalOsForNewTenant(db: AppDatabase): void {
  writeTenantKind(db, "personal");
  ensureTenantWorkspaceDirFromDb(db);

  updateAgent(db, "intelligence", {
    toolAllow: personalIntelligenceToolNames(),
  });

  syncPersonalBootstrapKnowledge(db);
}

/** Ensure tenant sandbox directory exists (called from coding tools). */
export function ensureTenantWorkspaceDir(tenantId: string): string {
  const dir = tenantWorkspaceDir(tenantId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureTenantWorkspaceDirFromDb(_db: AppDatabase): void {
  // Workspace dir is created on first coding-tool use; nothing required at seed.
}

/** Idempotent repair for existing personal tenants (e.g. after bootstrap pack changes). */
export function repairPersonalOsTenant(db: AppDatabase): void {
  repairPersonalTenantDefaults(db);
}
