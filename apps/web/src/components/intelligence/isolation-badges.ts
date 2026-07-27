/** Pure helpers for coding isolation badges on tool cards (#166 / #112). */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function collectIsolationBadgeLabels(opts: {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}): string[] {
  const { name, args, result } = opts;
  const res = asRecord(result);
  const isolation = asRecord(res?.isolation) ?? asRecord(args.isolation);
  const badges: string[] = [];

  const sandboxed =
    res?.sandboxed ?? (isolation?.sandboxed as boolean | undefined);
  if (typeof sandboxed === "boolean") {
    badges.push(sandboxed ? "sandboxed" : "host shell");
  }

  const netMode = res?.netMode ?? isolation?.netMode ?? args.netMode;
  if (typeof netMode === "string" && netMode) {
    badges.push(`net: ${netMode}`);
  }

  if (res?.mode === "ephemeral" || name === "run_ephemeral_build") {
    badges.push("ephemeral build");
  }

  const workspace =
    (typeof res?.workspace === "string" && res.workspace) ||
    (typeof isolation?.workspace === "string" && isolation.workspace) ||
    (typeof res?.worktreeSlug === "string" && res.worktreeSlug) ||
    (typeof args.workspace === "string" && args.workspace) ||
    (typeof args.slug === "string" && args.slug) ||
    "";
  if (workspace) {
    const short = workspace.includes(".worktrees/")
      ? workspace.slice(workspace.indexOf(".worktrees/"))
      : workspace.length > 40
        ? `…${workspace.slice(-37)}`
        : workspace;
    badges.push(`wt: ${short}`);
  }

  if (isolation?.target === "live_tenant_tree") {
    badges.push("→ live tree");
  }

  return badges;
}
