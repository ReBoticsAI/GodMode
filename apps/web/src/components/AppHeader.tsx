import { useLocation } from "react-router-dom";
import { ChevronRightIcon, MenuIcon, PanelRightOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  chromelessHeaderSegments,
  departmentFromPath,
  divisionFromPath,
  isChromelessPath,
  type DepartmentNode,
} from "@/lib/navigation";
import { useStructure } from "@/lib/structure-context";
import { usePageChrome } from "@/lib/page-chrome-context";
import { cn } from "@/lib/utils";
import { webPluginRuntime } from "@/plugins/runtime";

function activePageLabel(
  pathname: string,
  departments: DepartmentNode[]
): string | null {
  for (const d of departments) {
    for (const div of d.divisions) {
      for (const p of div.pages) {
        const full =
          p.segment === ""
            ? div.basePath
            : `${div.basePath.replace(/\/$/, "")}/${p.segment}`;
        if (pathname === full) return p.label;
      }
    }
  }
  return null;
}

function ChromelessBreadcrumb({ segments }: { segments: string[] }) {
  return (
    <span className="hidden items-center gap-1 sm:flex">
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 ? (
            <ChevronRightIcon className="size-3 shrink-0 opacity-50" />
          ) : null}
          <span
            className={cn(
              "truncate",
              index === segments.length - 1 && "font-medium text-foreground"
            )}
          >
            {segment}
          </span>
        </span>
      ))}
    </span>
  );
}

export function AppHeader({
  onOpenNav,
  onOpenRightPanel,
  rightPanelKind: _rightPanelKind,
}: {
  /** Opens the primary nav drawer (compact mode only). */
  onOpenNav?: () => void;
  /** Opens the plugin right-sidebar drawer (compact mode only). */
  onOpenRightPanel?: () => void;
  rightPanelKind?: string;
} = {}) {
  const { pathname } = useLocation();
  const { departments } = useStructure();
  const { headerOverride } = usePageChrome();

  const chromeless = isChromelessPath(pathname);
  const chromelessSegments = chromelessHeaderSegments(pathname);
  const department = chromeless
    ? undefined
    : departmentFromPath(pathname, departments);
  const division = chromeless
    ? undefined
    : divisionFromPath(pathname, departments);
  const pageLabel = chromeless
    ? null
    : activePageLabel(pathname, departments);
  const HeaderPluginChrome = division?.rightSidebar
    ? webPluginRuntime.shellForSlot(division.rightSidebar, "header")
    : null;

  const mobileLabel = chromelessSegments
    ? chromelessSegments[chromelessSegments.length - 1] ?? "Platform"
    : pageLabel ?? division?.label ?? department?.label ?? "";

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b bg-sidebar/60 px-2 text-xs sm:px-3">
      {onOpenNav && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-ml-1 shrink-0 lg:hidden"
          onClick={onOpenNav}
          aria-label="Open navigation menu"
        >
          <MenuIcon />
        </Button>
      )}
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1 truncate text-muted-foreground"
      >
        <span className="truncate font-medium text-foreground sm:hidden">
          {mobileLabel}
        </span>
        {chromelessSegments ? (
          <ChromelessBreadcrumb segments={chromelessSegments} />
        ) : (
          <span className="hidden items-center gap-1 sm:flex">
            {department && (
              <span className="truncate">{department.label}</span>
            )}
            {department && division && (
              <ChevronRightIcon className="size-3 shrink-0 opacity-50" />
            )}
            {division && <span className="truncate">{division.label}</span>}
            {(department || division) && pageLabel && (
              <ChevronRightIcon className="size-3 shrink-0 opacity-50" />
            )}
            {pageLabel && (
              <span className="truncate font-medium text-foreground">
                {pageLabel}
              </span>
            )}
          </span>
        )}
      </nav>

      {headerOverride ? headerOverride : HeaderPluginChrome ? <HeaderPluginChrome /> : null}

      {onOpenRightPanel && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-mr-1 shrink-0 lg:hidden"
          onClick={onOpenRightPanel}
          aria-label="Open side panel"
        >
          <PanelRightOpenIcon />
        </Button>
      )}
    </header>
  );
}
