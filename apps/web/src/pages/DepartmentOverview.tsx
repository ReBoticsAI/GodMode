import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  defaultPathForDivision,
  departmentFromPath,
} from "@/lib/navigation";
import { useStructure } from "@/lib/structure-context";
import { iconByName } from "@/lib/icon-lookup";

/**
 * Generic landing page rendered at a department's base path (e.g. /trading).
 * Lists the department's divisions as cards that deep-link to each division's
 * default page. The active department is resolved from the URL, falling back to
 * the optional `departmentId` the route passes in.
 */
export default function DepartmentOverview({
  departmentId,
}: {
  departmentId?: string;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { departments } = useStructure();

  const department =
    (departmentId && departments.find((d) => d.id === departmentId)) ||
    departmentFromPath(pathname, departments);

  if (!department) {
    return (
      <Page>
        <PageHeader title="Overview" />
      </Page>
    );
  }

  const DeptIcon = iconByName(department.icon);

  return (
    <Page>
      <PageHeader
        title={department.label}
        description={`Choose a workspace within ${department.label} to get started.`}
        actions={
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <DeptIcon className="size-5" />
          </span>
        }
      />

      {department.divisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No workspaces configured for this department yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {department.divisions.map((division) => {
            const DivIcon = iconByName(division.icon);
            return (
              <Card
                key={division.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(defaultPathForDivision(division))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(defaultPathForDivision(division));
                  }
                }}
                className="cursor-pointer transition-colors hover:border-sidebar-accent-foreground/40 hover:bg-accent/40"
              >
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                      <DivIcon className="size-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex items-center gap-1.5">
                        <span className="truncate">{division.label}</span>
                        <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      </CardTitle>
                      <CardDescription>
                        {division.pages.length}{" "}
                        {division.pages.length === 1 ? "page" : "pages"}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
