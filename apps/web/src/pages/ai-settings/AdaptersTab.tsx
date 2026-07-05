import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { fetchAiAdapters, updateAiAdapter, type AiAdapter } from "@/api";
import { TrainingPanel } from "@/pages/ai-settings/TrainingPanel";

export function AdaptersTab() {
  const [adapters, setAdapters] = useState<AiAdapter[]>([]);
  const [showTraining, setShowTraining] = useState(false);

  const loadAdapters = useCallback(() => {
    fetchAiAdapters()
      .then((r) => setAdapters(r.adapters))
      .catch(() => setAdapters([]));
  }, []);

  useEffect(() => {
    loadAdapters();
  }, [loadAdapters]);

  const toggleEnabled = async (adapter: AiAdapter, enabled: boolean) => {
    try {
      const updated = await updateAiAdapter(adapter.id, { enabled });
      setAdapters((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        LoRA adapters load via <code>--lora</code> on llama-server. Enable an adapter here;
        it applies on the next server restart.
      </p>
      {adapters.length === 0 && (
        <p className="text-xs text-muted-foreground">No adapters registered yet.</p>
      )}
      {adapters.map((a) => (
        <div key={a.id} className="rounded-md border px-2 py-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium">{a.name}</span>
            <Badge variant={a.enabled ? "default" : "secondary"} className="text-[10px]">
              {a.enabled ? "on" : "off"}
            </Badge>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">scale {a.default_scale}</span>
              <Switch
                checked={!!a.enabled}
                onCheckedChange={(v) => void toggleEnabled(a, v)}
              />
            </div>
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{a.path}</div>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => setShowTraining((v) => !v)}
      >
        {showTraining ? "Hide training" : "Train adapter (Unsloth)"}
      </Button>
      {showTraining && (
        <div className="border-t pt-3">
          <TrainingPanel />
        </div>
      )}
    </div>
  );
}
