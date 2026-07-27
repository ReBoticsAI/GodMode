/**
 * Shared allowlist + path helpers for Layer 4 ephemeral builds (#164 / #112).
 * Plain ESM for the host Node supervisor (no TypeScript syntax).
 */

export const ALLOWED_BUILD_COMMANDS = [
  "npm ci",
  "npm install",
  "npm run build",
  "npm test",
  "npm run typecheck",
];

export function isAllowedBuildCommand(command) {
  const normalized = String(command ?? "").trim().replace(/\s+/g, " ");
  return ALLOWED_BUILD_COMMANDS.includes(normalized);
}

export function normalizeBuildCommand(command) {
  const normalized = String(command ?? "").trim().replace(/\s+/g, " ");
  if (!isAllowedBuildCommand(normalized)) {
    throw new Error(
      `Command not allowed for ephemeral build: ${command}. Allowed: ${ALLOWED_BUILD_COMMANDS.join(", ")}`
    );
  }
  return normalized;
}

/** Reject absolute paths and .. segments; return posix-relative path under workspace. */
export function sanitizeCwdRel(cwdRel) {
  const raw = String(cwdRel ?? ".").trim() || ".";
  if (raw.includes("\0")) throw new Error("Invalid cwd");
  const parts = raw.replace(/\\/g, "/").split("/");
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error(`cwd escapes workspace: ${cwdRel}`);
    if (part.includes(":")) throw new Error(`Invalid cwd segment: ${part}`);
    out.push(part);
  }
  return out.length ? out.join("/") : ".";
}

/** Tenant id for bind path segment only (no path separators). */
export function sanitizeTenantId(tenantId) {
  const id = String(tenantId ?? "").trim();
  if (!id || /[\\/]/.test(id) || id.includes("..") || id.includes("\0")) {
    throw new Error("Invalid tenantId");
  }
  return id;
}

export function tenantWorkspaceHostPath(_dataDir, tenantId) {
  const safe = sanitizeTenantId(tenantId);
  return ["tenant-workspaces", safe].join("/");
}

export const LOCAL_SUPERVISOR_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "host.docker.internal",
]);
