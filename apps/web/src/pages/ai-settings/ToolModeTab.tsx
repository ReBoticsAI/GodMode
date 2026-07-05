import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AiSettings as AiSettingsType } from "@/api";

export function ToolModeTab({
  settings,
  saveSetting,
}: {
  settings: AiSettingsType | null;
  saveSetting: (patch: Partial<AiSettingsType>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Native tools sends OpenAI-style <code>tools</code> to llama-server (Gemma 4
        tool-calling template). When off, tools are listed as text in the system prompt.
      </p>
      <div className="flex items-center justify-between">
        <Label>Native tool calling</Label>
        <Switch
          checked={settings?.nativeTools ?? true}
          onCheckedChange={(v) => saveSetting({ nativeTools: v })}
        />
      </div>
    </div>
  );
}
