import type { ReactElement } from "react";
import { useParams } from "react-router-dom";
import { Page, PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useStructure } from "@/lib/structure-context";

/** Tenant-built custom page shell (Intelligence or marketplace packs can populate config). */
export default function TenantCustomPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const { nodes } = useStructure();
  const node = nodes.find((n) => n.id === pageId || n.segment === pageId);

  return (
    <Page>
      <PageHeader
        title={node?.label ?? "Custom page"}
        description="User-defined workspace page. Extend via Intelligence or a marketplace pack."
      />
      <Card>
        <CardHeader>
          <CardTitle>Page content</CardTitle>
          <CardDescription>
            Kind: custom · ID: {node?.id ?? pageId ?? "—"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This page is a blank canvas. Ask Intelligence to add widgets, data sources, or
            automations, or install a domain pack from the Marketplace.
          </p>
        </CardContent>
      </Card>
    </Page>
  );
}

export function tenantCustomPageElement(): ReactElement {
  return <TenantCustomPage />;
}
