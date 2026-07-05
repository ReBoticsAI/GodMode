import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Page, PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GROUP_TAB_DEFAULTS, type GroupTabDef } from "@/lib/group-tab-definitions";
import { useStructure } from "@/lib/structure-context";
import type { StructureNode } from "@/lib/navigation";
import { pageElementFor } from "@/lib/page-registry";

function flattenNodes(nodes: StructureNode[]): StructureNode[] {
  const out: StructureNode[] = [];
  const walk = (list: StructureNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function nodeForPath(nodes: StructureNode[], pathname: string): StructureNode | null {
  const flat = flattenNodes(nodes);
  const exact = flat.find((n) => n.path === pathname);
  if (exact) return exact;
  const prefixMatches = flat
    .filter((n) => n.path !== "/" && pathname.startsWith(`${n.path}/`))
    .sort((a, b) => b.path.length - a.path.length);
  return prefixMatches[0] ?? null;
}

export function StructureTabGroupPage({
  groupKind,
  title,
  description,
}: {
  groupKind: string;
  title?: string;
  description?: string;
}) {
  const { pathname } = useLocation();
  const { nodes } = useStructure();

  const node = useMemo(() => nodeForPath(nodes, pathname), [nodes, pathname]);

  const tabDefs: GroupTabDef[] = useMemo(() => {
    if (node?.tabs?.length) return node.tabs;
    return GROUP_TAB_DEFAULTS[groupKind] ?? [];
  }, [node?.tabs, groupKind]);

  const pageTitle = title ?? node?.label ?? "Group";
  const defaultTab = tabDefs[0]?.value ?? "main";

  if (tabDefs.length === 0) {
    return (
      <Page>
        <PageHeader title={pageTitle} description={description} />
        <p className="text-sm text-muted-foreground">No tabs configured for this group.</p>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={pageTitle} description={description} />
      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          {tabDefs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabDefs.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            {pageElementFor(t.kind)}
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}
