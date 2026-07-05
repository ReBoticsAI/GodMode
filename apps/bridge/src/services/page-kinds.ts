/**
 * Valid structure node `kind` values — must stay in sync with
 * apps/web/src/lib/page-registry.tsx PAGE_KINDS.
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
  "sierra-dashboard-group",
  "sierra-trading-plan-group",
  "sierra-playbooks-group",
  "sierra-config-group",
  "sierra-setup",
  "pm-dashboard-group",
  "pm-trading-plan-group",
  "pm-playbooks-group",
  "pm-config-group",
  "pm-dashboard",
  "pm-markets",
  "pm-trade",
  "pm-inefficiencies",
  "pm-activity",
  "pm-arbitrage",
  "pm-no-buy",
  "pm-market-making",
  "pm-wallets",
  "pm-positions",
  "pm-settings",
  "pm-deposits",
  "pm-negrisk-basket",
  "pm-trending",
  "pm-liquidity-crunch",
  "pm-stale-quotes",
  "pm-builder",
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];

const PAGE_KIND_SET = new Set<string>(PAGE_KINDS);

export function isValidPageKind(kind: string): kind is PageKind {
  return PAGE_KIND_SET.has(kind);
}
