/**
 * Tab layouts for group page kinds — plugins seed tabs_json on structure nodes.
 * Core keeps an empty fallback registry.
 */
export interface GroupTabDef {
  value: string;
  label: string;
  kind: string;
}

export const GROUP_TAB_DEFAULTS: Record<string, GroupTabDef[]> = {};

export function registerGroupTabDefaults(
  kind: string,
  tabs: GroupTabDef[]
): void {
  GROUP_TAB_DEFAULTS[kind] = tabs;
}
