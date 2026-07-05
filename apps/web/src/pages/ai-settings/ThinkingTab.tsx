import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AiSettings as AiSettingsType } from "@/api";

export function ThinkingTab({
  settings,
  saveSetting,
}: {
  settings: AiSettingsType | null;
  saveSetting: (patch: Partial<AiSettingsType>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Gemma 4 thinking mode injects <code>&lt;|think|&gt;</code> into the system turn.
      </p>
      <div className="flex items-center justify-between">
        <Label>Enable thinking</Label>
        <Switch
          checked={settings?.enableThinking ?? false}
          onCheckedChange={(v) => saveSetting({ enableThinking: v })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Efficiency</Label>
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-xs"
          value={settings?.thinkingEfficiency ?? "normal"}
          onChange={(e) =>
            saveSetting({ thinkingEfficiency: e.target.value as "normal" | "low" })
          }
        >
          <option value="normal">Normal depth</option>
          <option value="low">Low / efficient</option>
        </select>
      </div>
    </div>
  );
}
