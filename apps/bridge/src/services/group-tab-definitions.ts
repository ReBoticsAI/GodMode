/**
 * Tab layouts for group page kinds. Stored in structure_nodes.tabs_json and
 * mirrored on the web client (apps/web/src/lib/group-tab-definitions.ts).
 */
export interface GroupTabDef {
  value: string;
  label: string;
  /** Page kind rendered inside the tab (see page-registry). */
  kind: string;
}

export const GROUP_TAB_DEFAULTS: Record<string, GroupTabDef[]> = {
  "sierra-dashboard-group": [
    { value: "dashboard", label: "Dashboard", kind: "dashboard" },
    { value: "monitor", label: "Monitor", kind: "monitor" },
    { value: "performance", label: "Performance", kind: "performance" },
    { value: "journal", label: "Journal", kind: "journal" },
  ],
  "sierra-trading-plan-group": [
    { value: "plan", label: "Trading Plan", kind: "trading-plan" },
    { value: "routines", label: "Routines", kind: "routines" },
  ],
  "sierra-playbooks-group": [
    { value: "playbooks", label: "Playbooks", kind: "playbooks" },
    { value: "builder", label: "Builder", kind: "builder" },
    { value: "backtest", label: "Backtest", kind: "backtest" },
  ],
  "sierra-config-group": [
    { value: "setup", label: "Setup", kind: "sierra-setup" },
  ],
  "pm-dashboard-group": [
    { value: "dashboard", label: "Dashboard", kind: "pm-dashboard" },
    { value: "activity", label: "Activity", kind: "pm-activity" },
    { value: "positions", label: "Positions", kind: "pm-positions" },
  ],
  "pm-trading-plan-group": [
    { value: "inefficiencies", label: "Inefficiencies", kind: "pm-inefficiencies" },
    { value: "arbitrage", label: "Arbitrage", kind: "pm-arbitrage" },
    { value: "no-buy", label: "No-Buy", kind: "pm-no-buy" },
    { value: "market-making", label: "Market Making", kind: "pm-market-making" },
    { value: "negrisk-basket", label: "NegRisk Basket", kind: "pm-negrisk-basket" },
    { value: "trending", label: "Trending", kind: "pm-trending" },
    { value: "liquidity-crunch", label: "Liquidity Crunch", kind: "pm-liquidity-crunch" },
    { value: "stale-quotes", label: "Stale Quotes", kind: "pm-stale-quotes" },
  ],
  "pm-playbooks-group": [
    { value: "markets", label: "Markets", kind: "pm-markets" },
    { value: "trade", label: "Trade", kind: "pm-trade" },
    { value: "builder", label: "Builder", kind: "pm-builder" },
  ],
  "pm-config-group": [
    { value: "wallets", label: "Wallets", kind: "pm-wallets" },
    { value: "deposits", label: "Deposits", kind: "pm-deposits" },
    { value: "settings", label: "Settings", kind: "pm-settings" },
  ],
};

export function tabsJsonForKind(kind: string): string | null {
  const tabs = GROUP_TAB_DEFAULTS[kind];
  return tabs ? JSON.stringify(tabs) : null;
}

export function parseTabsJson(raw: string | null | undefined): GroupTabDef[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as GroupTabDef[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (t) =>
        t &&
        typeof t.value === "string" &&
        typeof t.label === "string" &&
        typeof t.kind === "string"
    );
  } catch {
    return null;
  }
}
