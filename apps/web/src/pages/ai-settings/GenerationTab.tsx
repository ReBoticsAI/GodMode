import { ImageIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AiInspect, AiSettings as AiSettingsType } from "@/api";
import { NumberField } from "./fields";

const GEMMA4_DEFAULTS: Partial<AiSettingsType> = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  minP: 0.05,
  repeatPenalty: 1.1,
  presencePenalty: 0,
  frequencyPenalty: 0,
  maxTokens: 2048,
  seed: -1,
};

export function GenerationTab({
  settings,
  inspect,
  saveSetting,
  onRefreshInspect,
}: {
  settings: AiSettingsType | null;
  inspect: AiInspect | null;
  saveSetting: (patch: Partial<AiSettingsType>) => void;
  onRefreshInspect: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Sampling</CardTitle>
            <CardDescription>Applied on the next chat message.</CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveSetting(GEMMA4_DEFAULTS)}
          >
            <RotateCwIcon data-icon="inline-start" />
            Gemma 4 defaults
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberField id="temperature" label="Temperature" value={settings?.temperature ?? 1} step={0.05} min={0} onCommit={(n) => saveSetting({ temperature: n })} />
          <NumberField id="topP" label="Top-P" value={settings?.topP ?? 0.95} step={0.01} max={1} onCommit={(n) => saveSetting({ topP: n })} />
          <NumberField id="topK" label="Top-K" value={settings?.topK ?? 64} onCommit={(n) => saveSetting({ topK: n })} />
          <NumberField id="minP" label="Min-P" value={settings?.minP ?? 0.05} step={0.01} max={1} onCommit={(n) => saveSetting({ minP: n })} />
          <NumberField id="repeatPenalty" label="Repeat penalty" value={settings?.repeatPenalty ?? 1.1} step={0.05} onCommit={(n) => saveSetting({ repeatPenalty: n })} />
          <NumberField id="presencePenalty" label="Presence penalty" value={settings?.presencePenalty ?? 0} step={0.05} onCommit={(n) => saveSetting({ presencePenalty: n })} />
          <NumberField id="frequencyPenalty" label="Frequency penalty" value={settings?.frequencyPenalty ?? 0} step={0.05} onCommit={(n) => saveSetting({ frequencyPenalty: n })} />
          <NumberField id="maxTokens" label="Max tokens" value={settings?.maxTokens ?? 2048} step={256} onCommit={(n) => saveSetting({ maxTokens: n })} />
          <NumberField id="seed" label="Seed" value={settings?.seed ?? -1} onCommit={(n) => saveSetting({ seed: n })} hint="-1 = random" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Last request</CardTitle>
          <CardDescription>
            <button type="button" onClick={onRefreshInspect} className="text-primary hover:underline">
              Refresh
            </button>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!inspect?.lastRequest ? (
            <p className="text-sm text-muted-foreground">Send a chat message first.</p>
          ) : (
            <>
              {inspect.sections && (
                <div className="flex flex-wrap gap-1">
                  {inspect.sections.filter((s) => s.included).map((s) => (
                    <Badge key={s.id} variant="outline" className="text-[10px]">
                      {s.label}
                    </Badge>
                  ))}
                </div>
              )}
              {inspect.lastRequest.messages.map((m, i) => (
                <div key={i} className="rounded-lg border bg-muted/20 p-2">
                  <Badge variant="secondary">{m.role}</Badge>
                  {m.images > 0 && <ImageIcon className="ml-1 inline size-3" />}
                  <pre className="mt-1 font-mono text-[10px] whitespace-pre-wrap">{m.preview}</pre>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
