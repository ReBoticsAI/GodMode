import { useEffect, useState } from "react";
import { BotIcon, LayersIcon, ListIcon } from "lucide-react";
import { fetchAdminWorkspaceTemplate, type WorkspaceTemplateNode } from "@/api";
import { iconByName } from "@/lib/icon-lookup";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

function TemplateTree({
  nodes,
  depth = 0,
}: {
  nodes: WorkspaceTemplateNode[];
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? "space-y-1" : "ml-4 space-y-1 border-l border-border/60 pl-3"}>
      {nodes.map((node) => {
        const Icon = iconByName(node.icon);
        return (
          <li key={node.id}>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate text-foreground">{node.label}</span>
              <span className="font-mono text-[10px] opacity-60">{node.kind}</span>
            </div>
            {node.children?.length ? (
              <TemplateTree nodes={node.children} depth={depth + 1} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Platform admin view of default workspace bootstrap for new signups — not the
 * live tenant editor at /structure.
 */
export function StructureAdminPanel() {
  const [structure, setStructure] = useState<WorkspaceTemplateNode | null>(null);
  const [sidebarPages, setSidebarPages] = useState<string[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; label: string; note: string }>>([]);
  const [welcomeWiki, setWelcomeWiki] = useState<{
    slug: string;
    title: string;
    space: string;
  } | null>(null);
  const [bootstrapNote, setBootstrapNote] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminWorkspaceTemplate()
      .then((r) => {
        setStructure(r.structure);
        setSidebarPages(r.sidebarPages);
        setAgents(r.agents);
        setWelcomeWiki(r.welcomeWiki);
        setBootstrapNote(r.bootstrapNote);
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to load template")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayersIcon className="size-4" />
            New tenant default
          </CardTitle>
          <CardDescription>
            {bootstrapNote ||
              "What every new hub signup receives on day one (code-seeded today)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading template…</p>
          ) : (
            <>
              <div>
                <h3 className="mb-2 text-sm font-medium">Structure tree</h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  Departments and pages in the navigation tree. New signups start empty;
                  users create them via Intelligence.
                </p>
                {structure ? (
                  <TemplateTree nodes={[structure]} />
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No default departments — empty tree until the user creates structure.
                  </p>
                )}
              </div>

              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <ListIcon className="size-3.5" />
                  Personal sidebar
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  Built-in routes outside the structure tree — always present for every tenant.
                </p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {sidebarPages.map((label) => (
                    <li key={label}>· {label}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <BotIcon className="size-3.5" />
                  Agents
                </h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {agents.map((a) => (
                    <li key={a.id}>
                      · <span className="text-foreground">{a.label}</span>
                      <span className="ml-1 text-xs opacity-70">({a.note})</span>
                    </li>
                  ))}
                </ul>
              </div>

              {welcomeWiki ? (
                <div>
                  <h3 className="mb-2 text-sm font-medium">Welcome wiki</h3>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground">{welcomeWiki.title}</span>
                    {" · "}
                    slug <code className="rounded bg-muted px-1 text-xs">{welcomeWiki.slug}</code>
                    {" · "}
                    space {welcomeWiki.space}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
