import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchAiCommands, type AiChatCommand } from "@/api";

export function CommandsTab() {
  const [commands, setCommands] = useState<AiChatCommand[]>([]);

  useEffect(() => {
    fetchAiCommands()
      .then((r) => setCommands(r.commands))
      .catch(() => setCommands([]));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat commands</CardTitle>
        <CardDescription>
          Type <code className="text-xs">/</code> in chat for autocomplete. Client commands run
          immediately; server commands attach context to your next message.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {commands.map((c) => (
          <div key={c.name} className="flex items-start justify-between rounded-lg border px-3 py-2">
            <div>
              <code className="text-sm font-medium">{c.usage}</code>
              <p className="text-xs text-muted-foreground">{c.description}</p>
            </div>
            <Badge variant="outline">{c.runsOn}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
