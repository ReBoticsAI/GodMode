import { useEffect, useState } from "react";
import { fetchProfile, updateAiAgent, type AiAgent, type AgentTypedProfile, type UserProfile } from "@/api";
import { isUserAgentId } from "@/lib/structure-agents";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function readProfile(agent: AiAgent): AgentTypedProfile {
  const raw = agent.config?.profile as Partial<AgentTypedProfile> | undefined;
  return {
    purpose: raw?.purpose ?? "",
    domain: raw?.domain ?? "",
    mandate: raw?.mandate ?? "",
    escalatesTo: raw?.escalatesTo ?? "",
    notes: raw?.notes ?? "",
    headline: raw?.headline ?? "",
    bio: raw?.bio ?? "",
    location: raw?.location ?? "",
    timezone: raw?.timezone ?? "",
    languages: raw?.languages ?? "",
    interests: raw?.interests ?? "",
    values: raw?.values ?? "",
    goals: raw?.goals ?? "",
    personalityNotes: raw?.personalityNotes ?? "",
    decisionStyle: raw?.decisionStyle ?? "",
    riskTolerance: raw?.riskTolerance ?? "",
    communicationStyle: raw?.communicationStyle ?? "",
  };
}

export function AgentProfilePanel({
  agent,
  onSaved,
}: {
  agent: AiAgent;
  onSaved: (agent: AiAgent) => void;
}) {
  const isPersona = isUserAgentId(agent.id);
  const [humanProfile, setHumanProfile] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<AgentTypedProfile>(() => readProfile(agent));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(readProfile(agent));
  }, [agent.id, agent.updatedAt]);

  useEffect(() => {
    if (!isPersona) return;
    fetchProfile()
      .then((r) => setHumanProfile(r.profile))
      .catch(() => setHumanProfile(null));
  }, [isPersona]);

  const save = async () => {
    setSaving(true);
    try {
      const nextConfig = {
        ...(agent.config ?? {}),
        profile: {
          purpose: form.purpose || null,
          domain: form.domain || null,
          mandate: form.mandate || null,
          escalatesTo: form.escalatesTo || null,
          notes: form.notes || null,
          headline: form.headline || null,
          bio: form.bio || null,
          location: form.location || null,
          timezone: form.timezone || null,
          languages: form.languages || null,
          interests: form.interests || null,
          values: form.values || null,
          goals: form.goals || null,
          personalityNotes: form.personalityNotes || null,
          decisionStyle: form.decisionStyle || null,
          riskTolerance: form.riskTolerance || null,
          communicationStyle: form.communicationStyle || null,
        },
      };
      const updated = await updateAiAgent(agent.id, { config: nextConfig });
      onSaved(updated);
      toast.success("Agent profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (isPersona) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          This agent mirrors your user profile from Settings → Users. Edit your
          human profile there; reflections can propose updates.
        </p>
        {humanProfile ? (
          <div className="flex flex-col gap-2 rounded-md border p-3 text-xs">
            <div className="font-medium">{humanProfile.displayName}</div>
            {humanProfile.headline && (
              <div className="text-muted-foreground">{humanProfile.headline}</div>
            )}
            {humanProfile.bio && <p>{humanProfile.bio}</p>}
            {humanProfile.goals && (
              <p>
                <span className="font-medium">Goals:</span> {humanProfile.goals}
              </p>
            )}
            {humanProfile.values && (
              <p>
                <span className="font-medium">Values:</span> {humanProfile.values}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Loading profile…</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Typed agent identity feeds the Profile node in the prompt pipeline.
      </p>
      <div className="grid gap-4">
        <div className="grid gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Agent role
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Purpose</Label>
            <Input
              className="h-8 text-xs"
              value={form.purpose ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Domain</Label>
            <Input
              className="h-8 text-xs"
              value={form.domain ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Mandate</Label>
            <Textarea
              rows={2}
              className="text-xs"
              value={form.mandate ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, mandate: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Escalates to</Label>
            <Input
              className="h-8 text-xs"
              placeholder="Intelligence"
              value={form.escalatesTo ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, escalatesTo: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Identity & style
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Headline</Label>
            <Input
              className="h-8 text-xs"
              value={form.headline ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Bio</Label>
            <Textarea
              rows={3}
              className="text-xs"
              value={form.bio ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Communication style</Label>
            <Input
              className="h-8 text-xs"
              value={form.communicationStyle ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, communicationStyle: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Languages</Label>
            <Input
              className="h-8 text-xs"
              value={form.languages ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, languages: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Interests</Label>
            <Input
              className="h-8 text-xs"
              value={form.interests ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, interests: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Location</Label>
            <Input
              className="h-8 text-xs"
              value={form.location ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Timezone</Label>
            <Input
              className="h-8 text-xs"
              value={form.timezone ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Disposition
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Values</Label>
            <Textarea
              rows={2}
              className="text-xs"
              value={form.values ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, values: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Goals</Label>
            <Textarea
              rows={2}
              className="text-xs"
              value={form.goals ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Decision style</Label>
            <Input
              className="h-8 text-xs"
              value={form.decisionStyle ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, decisionStyle: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Risk tolerance</Label>
            <Input
              className="h-8 text-xs"
              value={form.riskTolerance ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, riskTolerance: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Personality notes</Label>
            <Textarea
              rows={2}
              className="text-xs"
              value={form.personalityNotes ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, personalityNotes: e.target.value }))
              }
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea
            rows={3}
            className="text-xs"
            value={form.notes ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>
      <Button size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save profile"}
      </Button>
    </div>
  );
}
