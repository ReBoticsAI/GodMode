export interface GitWorkspaceSnapshot {
  branch: string;
  dirtyCount: number;
  ahead: number;
  behind: number;
  summary: string;
}

export interface PlatformContext {
  breadcrumb?: string[];
  pathname?: string;
  pageKind?: string;
  pageLabel?: string;
  pageSnapshot?: unknown;
  mentionedSources?: Array<{ id: string; label: string; data: unknown }>;
  /** Compact coding-root git status (server-enriched). */
  gitSnapshot?: GitWorkspaceSnapshot;
}
