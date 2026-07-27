/**
 * Shared allowlist + path helpers for Layer 4 ephemeral builds (#164 / #167 / #112).
 * Plain ESM for the host Node supervisor (no TypeScript syntax).
 */

export const ALLOWED_BUILD_COMMANDS = [
  "npm ci",
  "npm install",
  "npm run build",
  "npm test",
  "npm run typecheck",
];

/** Same defaults as Bridge terminal egress (npm/git). */
export const DEFAULT_BUILD_EGRESS_HOSTS = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
  "ghcr.io",
  "nodejs.org",
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

/** @returns {"none"|"allowlist"} */
export function normalizeBuildNet(raw) {
  const mode = String(raw ?? "").trim().toLowerCase();
  if (mode === "allowlist") return "allowlist";
  if (!mode || mode === "none") return "none";
  throw new Error(
    `Invalid build network mode: ${raw}. Allowed: none, allowlist (shared is out of scope)`
  );
}

export function resolveBuildEgressHosts(hosts) {
  const fromArg = (hosts ?? [])
    .map((h) => String(h).trim().toLowerCase())
    .filter(Boolean);
  if (fromArg.length) return fromArg;
  const fromEnv = String(
    process.env.CODING_BUILD_EGRESS_HOSTS ||
      process.env.CODING_TERMINAL_EGRESS_HOSTS ||
      ""
  )
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : [...DEFAULT_BUILD_EGRESS_HOSTS];
}

/**
 * Exact match or leading `*.example.com` suffix rule.
 * Rejects empty hosts. IP literals and localhost are denied unless explicitly listed.
 */
export function isEgressHostAllowed(host, allowlist) {
  const h = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!h) return false;

  const listedExact = allowlist.some((rule) => rule === h);
  const isLoopbackName =
    h === "localhost" ||
    h === "localhost.localdomain" ||
    h.endsWith(".localhost");
  const looksLikeIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");
  if ((looksLikeIp || isLoopbackName) && !listedExact) {
    return false;
  }

  for (const rule of allowlist) {
    const r = String(rule ?? "").trim().toLowerCase();
    if (!r) continue;
    if (r === h) return true;
    if (r.startsWith("*.")) {
      const suffix = r.slice(1);
      if (h === r.slice(2) || h.endsWith(suffix)) return true;
    }
  }
  return false;
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
