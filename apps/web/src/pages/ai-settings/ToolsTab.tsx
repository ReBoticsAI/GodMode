import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchAiToolsRegistry, fetchAiInspect, type AiToolDef } from "@/api";

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  platform: "Platform structure",
  tasks: "Tasks & Kanban",
  trading: "Trading",
  coding: "Coding",
};

export function ToolsTab({ agentId = "intelligence" }: { agentId?: string }) {
  const [tools, setTools] = useState<AiToolDef[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetchAiToolsRegistry(agentId)
      .then((r) => setTools(r.tools))
      .catch(() => setTools([]));
    fetchAiInspect({ agentId })
      .then((i) => setNote(i.toolsNote))
      .catch(() => undefined);
  }, [agentId]);

  const grouped = useMemo(() => {
    const map = new Map<string, AiToolDef[]>();
    for (const t of tools) {
      const key = t.category ?? "general";
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tools]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tools</CardTitle>
        <CardDescription>
          {note || "Effective tools for this agent in your workspace."}
          {agentId !== "intelligence" ? (
            <span className="mt-1 block text-xs">Agent: {agentId}</span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {grouped.map(([category, items]) => (
          <div key={category} className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {CATEGORY_LABELS[category] ?? category}
            </p>
            {items.map((t) => (
              <div
                key={t.name}
                className="flex items-start justify-between rounded-lg border px-3 py-2"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <code className="text-sm font-medium">{t.name}</code>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                  {t.departments?.length ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Departments: {t.departments.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    variant={t.mode === "auto" ? "secondary" : "outline"}
                    className={t.mode === "confirm" ? "border-amber-500/50 text-amber-600" : ""}
                  >
                    {t.mode}
                  </Badge>
                  {t.write ? (
                    <Badge variant="outline" className="text-[10px]">
                      writes
                    </Badge>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ))}
        {tools.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tools available for this agent.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
