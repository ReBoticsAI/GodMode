import type { ReactElement } from "react";
import Home from "@/pages/Home";
import Placeholder from "@/pages/Placeholder";
import TenantCustomPage from "@/pages/TenantCustomPage";
import RecordListPage from "@/pages/records/RecordListPage";
import RecordFormPage from "@/pages/records/RecordFormPage";
import { webPluginRuntime } from "@/plugins/runtime";

/** Core page kinds — plugin domains register additional kinds at runtime. */
export const CORE_PAGE_KINDS = [
  "placeholder",
  "home",
  "custom",
  "record-list",
  "record-form",
] as const;

export type CorePageKind = (typeof CORE_PAGE_KINDS)[number];

const CORE_RENDERERS: Record<CorePageKind, () => ReactElement> = {
  placeholder: () => <Placeholder />,
  home: () => <Home />,
  custom: () => <TenantCustomPage />,
  "record-list": () => <RecordListPage />,
  "record-form": () => <RecordFormPage />,
};

export function pageElementFor(kind: string): ReactElement {
  const core = CORE_RENDERERS[kind as CorePageKind];
  if (core) return core();
  return webPluginRuntime.pageElement(kind, () => CORE_RENDERERS.placeholder());
}

/** @deprecated Use dynamic plugin registration; kept for structure editor labels. */
export const PAGE_KINDS = [
  ...CORE_PAGE_KINDS,
  "dashboard",
  "routines",
  "performance",
  "trading-plan",
  "playbooks",
  "builder",
  "monitor",
  "journal",
  "backtest",
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
