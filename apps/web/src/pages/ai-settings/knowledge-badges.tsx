import { SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const ROOT_AGENT_ID = "intelligence";

export type KnowledgeStatusFilter = "all" | "active" | "disabled" | "pending";

export function isInherited(ownerAgentId: string | undefined, activeAgentId: string): boolean {
  return (ownerAgentId ?? ROOT_AGENT_ID) === ROOT_AGENT_ID && activeAgentId !== ROOT_AGENT_ID;
}

export function OwnershipBadge({
  ownerAgentId,
  activeAgentId,
}: {
  ownerAgentId?: string;
  activeAgentId: string;
}) {
  const owner = ownerAgentId ?? ROOT_AGENT_ID;
  const inherited = isInherited(owner, activeAgentId);
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px]",
        inherited ? "border-violet-500/40 text-violet-600" : "border-sky-500/40 text-sky-600"
      )}
    >
      {inherited ? "Inherited" : "Own"}
    </Badge>
  );
}

export function VersionMeta({
  version,
  updatedAt,
}: {
  version?: number;
  updatedAt?: string;
}) {
  if (version == null && !updatedAt) return null;
  return (
    <p className="text-[10px] text-muted-foreground">
      {version != null ? `v${version}` : ""}
      {version != null && updatedAt ? " · " : ""}
      {updatedAt ? `updated ${updatedAt}` : ""}
    </p>
  );
}

export function KnowledgeSummaryLine({
  active,
  disabled,
  pending,
  inherited,
}: {
  active: number;
  disabled: number;
  pending: number;
  inherited: number;
}) {
  return (
    <p className="text-[11px] text-muted-foreground">
      {active} active · {disabled} disabled · {pending} pending
      {inherited > 0 ? ` · ${inherited} inherited from root` : ""}
    </p>
  );
}

export function KnowledgeSearchFilterBar<T extends string>({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  filters,
  placeholder,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  filter: T;
  onFilterChange: (v: T) => void;
  filters: Array<{ id: T; label: string }>;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="pl-8"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {filters.map(({ id, label }) => (
          <Button
            key={String(id)}
            type="button"
            size="sm"
            variant={filter === id ? "default" : "outline"}
            className="text-xs"
            onClick={() => onFilterChange(id)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function matchesKnowledgeStatusFilter(
  filter: KnowledgeStatusFilter,
  item: { status?: "active" | "pending"; enabled: boolean }
): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return item.status === "pending";
  if (filter === "disabled") return item.status !== "pending" && !item.enabled;
  return item.status !== "pending" && item.enabled;
}
