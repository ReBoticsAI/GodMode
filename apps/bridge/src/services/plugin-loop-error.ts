import path from "node:path";
import type { CoreDatabase } from "../core-db.js";
import { createNotification } from "./notification-service.js";

export type PluginLoopFailureClass = "manifest" | "build" | "isolation" | "install";

export class PluginLoopError extends Error {
  readonly failureClass: PluginLoopFailureClass;
  readonly status: number;

  constructor(failureClass: PluginLoopFailureClass, message: string, status = 400) {
    super(message);
    this.name = "PluginLoopError";
    this.failureClass = failureClass;
    this.status = status;
  }
}

export function isPluginLoopError(err: unknown): err is PluginLoopError {
  return err instanceof PluginLoopError;
}

export function isLocalPluginFolderRegistrationBlocked(opts: {
  isSaas: boolean;
  saasAllowLocalPlugins: boolean;
}): boolean {
  return opts.isSaas && !opts.saasAllowLocalPlugins;
}

/** Fail closed when a plugin root sits under a Layer 2 `.worktrees` segment. */
export function assertLivePluginRoot(pluginRoot: string): string {
  const resolved = path.resolve(pluginRoot);
  const parts = resolved.split(/[/\\]+/).filter(Boolean);
  if (parts.includes(".worktrees")) {
    throw new PluginLoopError(
      "isolation",
      "Plugin install paths must stay under the live tenant plugins/ dir, never under .worktrees/. Promote the worktree first, then install from plugins/<id>."
    );
  }
  return resolved;
}

export function toPluginLoopError(err: unknown): PluginLoopError {
  if (err instanceof PluginLoopError) return err;
  const status =
    typeof err === "object" && err && "status" in err
      ? Number((err as { status: unknown }).status)
      : NaN;
  const message = err instanceof Error ? err.message : String(err);
  const safeStatus = Number.isFinite(status) && status >= 400 ? status : undefined;
  if (/godmode\.plugin\.json|Missing godmode|invalid manifest|manifest/i.test(message)) {
    return new PluginLoopError("manifest", message, safeStatus ?? 400);
  }
  if (/worktrees|isolation|coding root|escapes tenant/i.test(message)) {
    return new PluginLoopError("isolation", message, safeStatus ?? 400);
  }
  if (/esbuild|src\/bridge|plugin build|bridge entry/i.test(message)) {
    return new PluginLoopError("build", message, safeStatus ?? 400);
  }
  return new PluginLoopError("install", message, safeStatus ?? 500);
}

export function notifyPluginLoopFailure(opts: {
  tenantId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  pluginId?: string | null;
  failureClass: PluginLoopFailureClass;
  message: string;
  db?: CoreDatabase;
}): void {
  const title = `Plugin ${opts.failureClass} failed`;
  const body = opts.message;
  const common = {
    category: "plugin_loop",
    title,
    body,
    link: "/coding",
    resourceKind: "plugin" as const,
    resourceId: opts.pluginId ?? null,
    recipientTenantId: opts.tenantId ?? null,
  };
  try {
    if (opts.userId?.trim()) {
      createNotification(
        {
          ...common,
          recipientKind: "user",
          recipientId: opts.userId.trim(),
        },
        opts.db
      );
    }
    if (opts.agentId?.trim()) {
      createNotification(
        {
          ...common,
          recipientKind: "agent",
          recipientId: opts.agentId.trim(),
        },
        opts.db
      );
    }
  } catch {
    /* notifications table missing or broker unavailable */
  }
}
