import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenant } from "@/lib/tenant-context";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";

export function WorkspaceSwitcher() {
  const { tenants, activeTenantId, setTenant, loading } = useTenant();
  if (loading) return null;

  return (
    <div className="flex w-full items-center gap-1">
      {tenants.length > 0 && (
        <Select
          value={activeTenantId ?? undefined}
          onValueChange={(v) => v && setTenant(v)}
        >
          <SelectTrigger className="h-8 w-full min-w-0 flex-1 text-xs">
            <SelectValue placeholder="Project">
              {(value) => {
                const active = tenants.find((t) => t.id === value);
                if (!active) return "Project";
                return active.name;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
                {t.is_operator ? " (operator)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <CreateWorkspaceDialog
        trigger={
          <button
            type="button"
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            title="New project"
          >
            +
          </button>
        }
      />
    </div>
  );
}
