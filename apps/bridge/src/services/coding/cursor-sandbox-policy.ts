/**
 * Tenant-scoped Cursor SDK sandbox.json for network allowlist (#171 / #112).
 * Never writes ~/.cursor/sandbox.json (host-wide; unsafe on multi-tenant hub).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../config.js";
import {
  DEFAULT_TERMINAL_EGRESS_HOSTS,
  resolveEgressAllowlist,
} from "./terminal-egress-proxy.js";

export type CursorSandboxNetworkPolicy = {
  default: "allow" | "deny";
  allow: string[];
  deny?: string[];
};

export type CursorSandboxJson = {
  networkPolicy: CursorSandboxNetworkPolicy;
};

/** Hosts for SDK sandbox networkPolicy.allow (terminal egress defaults). */
export function resolveCursorSdkSandboxHosts(hosts?: string[]): string[] {
  return resolveEgressAllowlist(
    hosts ?? config.codingTerminalEgressHosts
  );
}

export function buildCursorSandboxJson(hosts?: string[]): CursorSandboxJson {
  return {
    networkPolicy: {
      default: "deny",
      allow: resolveCursorSdkSandboxHosts(hosts),
    },
  };
}

/**
 * Ensure `{cwd}/.cursor/sandbox.json` exists when SDK sandbox is enabled.
 * Skip-if-exists so tenant-authored policy is never clobbered.
 *
 * @returns created | exists | skipped
 */
export function ensureTenantCursorSandboxJson(
  cwd: string,
  opts?: { hosts?: string[]; force?: boolean }
): "created" | "exists" | "skipped" {
  const root = String(cwd ?? "").trim();
  if (!root) return "skipped";
  const cursorDir = join(root, ".cursor");
  const filePath = join(cursorDir, "sandbox.json");
  if (!opts?.force && existsSync(filePath)) return "exists";
  mkdirSync(cursorDir, { recursive: true });
  const body = buildCursorSandboxJson(opts?.hosts);
  writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return "created";
}

export { DEFAULT_TERMINAL_EGRESS_HOSTS };
