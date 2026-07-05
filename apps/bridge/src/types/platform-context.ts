export interface PlatformContext {
  breadcrumb?: string[];
  pathname?: string;
  pageKind?: string;
  pageLabel?: string;
  pageSnapshot?: unknown;
  mentionedSources?: Array<{ id: string; label: string; data: unknown }>;
}
