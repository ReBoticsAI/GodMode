/**
 * Valid structure node `kind` values for personal-OS core.
 * Plugins register additional kinds via registerPageKinds / web pageKinds.register.
 * Keep in sync with apps/web/src/lib/page-registry.tsx CORE_PAGE_KINDS (+ generic kinds below).
 */
export const PAGE_KINDS = [
  "dashboard",
  "routines",
  "performance",
  "trading-plan",
  "playbooks",
  "builder",
  "monitor",
  "journal",
  "backtest",
  "placeholder",
  "home",
  "custom",
  "record-list",
  "record-form",
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];

const PAGE_KIND_SET = new Set<string>(PAGE_KINDS);

export function isValidPageKind(kind: string): kind is PageKind {
  return PAGE_KIND_SET.has(kind);
}
