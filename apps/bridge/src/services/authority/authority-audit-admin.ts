/**
 * Unified authority audit feed (#96 Slice 7).
 * Merges per-domain reject feeds from tool_audit_log.
 */
import { listCodingAuthorityEvents } from "../coding/coding-authority-admin.js";
import { listDeleteAuthorityEvents } from "./delete-authority-admin.js";
import { listDeployAuthorityEvents } from "./deploy-authority-admin.js";
import { listSendAuthorityEvents } from "./send-authority-admin.js";
import { listSpendAuthorityEvents } from "./spend-authority-admin.js";
import { listAgentPauseAuthorityEvents } from "./agent-pause-authority-admin.js";

export type AuthorityAuditDomain =
  | "coding"
  | "spend"
  | "deploy"
  | "delete"
  | "send"
  | "agent";

export const AUTHORITY_AUDIT_DOMAINS: AuthorityAuditDomain[] = [
  "coding",
  "spend",
  "deploy",
  "delete",
  "send",
  "agent",
];

export type AuthorityAuditEvent = {
  domain: AuthorityAuditDomain;
  tenantId: string;
  tenantName: string | null;
  agentId: string;
  userId: string | null;
  action: string;
  result: string;
  command: string | null;
  createdAt: string;
};

type RawEvent = {
  tenantId: string;
  tenantName: string | null;
  agentId: string;
  userId: string | null;
  action: string;
  result: string;
  command: string | null;
  createdAt: string;
};

/** Classify a tool_audit_log result into an authority domain. */
export function classifyAuthorityResult(
  result: string
): AuthorityAuditDomain | null {
  const r = String(result ?? "");
  if (r.startsWith("quota:")) return "coding";
  if (r.includes("spend")) return "spend";
  if (r.includes("deploy")) return "deploy";
  if (r.includes("delete")) return "delete";
  if (r.includes("send")) return "send";
  if (r.includes("agent")) return "agent";
  if (
    r.includes("coding") ||
    r.includes("builds") ||
    r.includes("terminal") ||
    r.includes("pty") ||
    r.startsWith("kill:")
  ) {
    return "coding";
  }
  return null;
}

function eventKey(e: Pick<RawEvent, "tenantId" | "createdAt" | "agentId" | "action" | "result">): string {
  return `${e.tenantId}|${e.createdAt}|${e.agentId}|${e.action}|${e.result}`;
}

/** Prefer specific domains over coding when the same row appears twice. */
const DOMAIN_PRIORITY: Record<AuthorityAuditDomain, number> = {
  agent: 6,
  spend: 5,
  deploy: 4,
  delete: 3,
  send: 2,
  coding: 1,
};

function tag(
  events: RawEvent[],
  forcedDomain?: AuthorityAuditDomain
): AuthorityAuditEvent[] {
  const out: AuthorityAuditEvent[] = [];
  for (const e of events) {
    const domain = forcedDomain ?? classifyAuthorityResult(e.result);
    if (!domain) continue;
    out.push({ ...e, domain });
  }
  return out;
}

export type ListAuthorityAuditEventsOpts = {
  limit?: number;
  domain?: AuthorityAuditDomain | string | null;
  tenantId?: string | null;
};

export function listAuthorityAuditEvents(
  opts: ListAuthorityAuditEventsOpts = {}
): AuthorityAuditEvent[] {
  const cap = Math.max(1, Math.min(Math.floor(opts.limit ?? 100) || 100, 500));
  const domainFilter = String(opts.domain ?? "")
    .trim()
    .toLowerCase() as AuthorityAuditDomain | "";
  const tenantFilter = String(opts.tenantId ?? "").trim();

  // Fetch enough from each source; coding is broad and overlaps others.
  const perSource = cap;
  const merged: AuthorityAuditEvent[] = [
    ...tag(listCodingAuthorityEvents(perSource)),
    ...tag(listSpendAuthorityEvents(perSource), "spend"),
    ...tag(listDeployAuthorityEvents(perSource), "deploy"),
    ...tag(listDeleteAuthorityEvents(perSource), "delete"),
    ...tag(listSendAuthorityEvents(perSource), "send"),
    ...tag(listAgentPauseAuthorityEvents(perSource), "agent"),
  ];

  const byKey = new Map<string, AuthorityAuditEvent>();
  for (const ev of merged) {
    const key = eventKey(ev);
    const prev = byKey.get(key);
    if (!prev || DOMAIN_PRIORITY[ev.domain] > DOMAIN_PRIORITY[prev.domain]) {
      byKey.set(key, ev);
    }
  }

  let events = Array.from(byKey.values());
  if (
    domainFilter &&
    (AUTHORITY_AUDIT_DOMAINS as string[]).includes(domainFilter)
  ) {
    events = events.filter((e) => e.domain === domainFilter);
  }
  if (tenantFilter) {
    events = events.filter((e) => e.tenantId === tenantFilter);
  }

  events.sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
  return events.slice(0, cap);
}
