/**
 * Tab layouts for group page kinds. Domain plugins own their group tabs;
 * core ships an empty registry. tabs_json on structure nodes is authoritative.
 */
export interface GroupTabDef {
  value: string;
  label: string;
  /** Page kind rendered inside the tab (see page-registry). */
  kind: string;
}

export const GROUP_TAB_DEFAULTS: Record<string, GroupTabDef[]> = {};

export function registerGroupTabDefaults(
  kind: string,
  tabs: GroupTabDef[]
): void {
  GROUP_TAB_DEFAULTS[kind] = tabs;
}

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
