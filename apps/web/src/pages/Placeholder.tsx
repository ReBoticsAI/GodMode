import { Link, useLocation } from "react-router-dom";
import { Settings2Icon } from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import {
  STRUCTURE_PATH,
  type DepartmentNode,
  type DivisionNode,
  type PageNode,
} from "@/lib/navigation";
import { useStructure } from "@/lib/structure-context";

function findContext(pathname: string, departments: DepartmentNode[]):
  | { department: DepartmentNode; division: DivisionNode; page: PageNode | undefined }
  | undefined {
  for (const d of departments) {
    for (const div of d.divisions) {
      for (const p of div.pages) {
        const full =
          p.segment === ""
            ? div.basePath
            : `${div.basePath.replace(/\/$/, "")}/${p.segment}`;
        if (pathname === full) {
          return { department: d, division: div, page: p };
        }
      }
    }
  }
  return undefined;
}

export default function Placeholder() {
  const { pathname } = useLocation();
  const { departments } = useStructure();
  const ctx = findContext(pathname, departments);

  const title = ctx?.page?.label ?? "Coming soon";
  const breadcrumb = ctx
    ? `${ctx.department.label} \u203A ${ctx.division.label}`
    : "Unknown location";

  return (
    <Page>
      <PageHeader title={title} description={breadcrumb} />
      <Card>
        <CardHeader>
          <CardTitle>No content yet</CardTitle>
          <CardDescription>
            This page is a placeholder. Configure or rename it from the structure
            settings, or replace its kind in code to wire up real content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Empty placeholder</EmptyTitle>
              <EmptyDescription>
                Pages added through the Structure settings render this view by
                default.
              </EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" render={<Link to={STRUCTURE_PATH} />}>
              <Settings2Icon className="size-4" />
              Open Structure editor
            </Button>
          </Empty>
        </CardContent>
      </Card>
    </Page>
  );
}
