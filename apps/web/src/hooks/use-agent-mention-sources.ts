import { useEffect } from "react";
import {
  api,
  fetchAiAgents,
  fetchAiArtifact,
  fetchAiArtifacts,
  fetchAiMemories,
  fetchAiRules,
  fetchAiSkills,
  fetchPlaybooks,
  fetchRepoMentionPaths,
} from "@/api";
import { useIntelligence, type MentionSource } from "@/lib/intelligence-context";

const MAX_ARTIFACTS = 80;
const MAX_MEMORIES = 40;

function trimLabel(text: string, max = 48): string {
  const s = text.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Registers @-mentionable context for the active agent (artifacts, playbooks, skills, etc.). */
export function useAgentMentionSources(agentId: string | undefined, enabled: boolean): void {
  const { registerMentionSource, pageSnapshot } = useIntelligence();
  const pageKey = pageSnapshot ? JSON.stringify(pageSnapshot) : null;

  useEffect(() => {
    if (!enabled || !agentId) return;

    let cancelled = false;
    const cleanups: Array<() => void> = [];

    void (async () => {
      const sources: MentionSource[] = [];

      if (pageSnapshot) {
        sources.push({
          id: `page:${pageSnapshot.kind}`,
          label: pageSnapshot.label ?? pageSnapshot.kind,
          category: "Page",
          resolve: () => pageSnapshot.data,
        });
      }

      const [artifactsRes, skillsRes, playbooks, rulesRes, memories, agentsRes, plan] =
        await Promise.all([
          fetchAiArtifacts(agentId, MAX_ARTIFACTS).catch(() => ({ artifacts: [] })),
          fetchAiSkills(true, agentId).catch(() => ({ skills: [] })),
          fetchPlaybooks().catch(() => []),
          fetchAiRules(agentId).catch(() => ({ rules: [] })),
          fetchAiMemories(undefined, agentId, "active").catch(() => []),
          fetchAiAgents().catch(() => ({ agents: [] })),
          api<Record<string, unknown>>("/trading-plan").catch(() => null),
        ]);

      if (cancelled) return;

      if (plan) {
        sources.push({
          id: "trading-plan",
          label: "Trading plan",
          category: "Trading",
          resolve: () => plan,
        });
      }

      const enabledRules = rulesRes.rules.filter((r) => r.enabled && r.status !== "pending");
      if (enabledRules.length > 0) {
        sources.push({
          id: "agent-rules",
          label: `Agent rules (${enabledRules.length})`,
          category: "Rules",
          resolve: () => ({ rules: enabledRules }),
        });
      }

      for (const a of artifactsRes.artifacts) {
        sources.push({
          id: `artifact:${a.id}`,
          label: trimLabel(a.name),
          category: "Artifacts",
          resolve: async () => {
            const row = await fetchAiArtifact(a.id, agentId, true);
            return {
              id: row.id,
              name: row.name,
              kind: row.kind,
              description: row.description,
              content: row.content,
            };
          },
        });
      }

      for (const pb of playbooks) {
        let spec: unknown = pb.spec_json;
        try {
          spec = JSON.parse(pb.spec_json);
        } catch {
          /* keep raw string */
        }
        sources.push({
          id: `playbook:${pb.id}`,
          label: trimLabel(`${pb.id} — ${pb.name}`),
          category: "Playbooks",
          resolve: () => ({
            id: pb.id,
            name: pb.name,
            status: pb.status,
            version: pb.version,
            spec,
          }),
        });
      }

      for (const skill of skillsRes.skills.filter(
        (s) => s.enabled && s.status !== "pending"
      )) {
        sources.push({
          id: `skill:${skill.id}`,
          label: trimLabel(skill.name),
          category: "Skills",
          resolve: () => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            tools: skill.tools,
            body: skill.body,
          }),
        });
      }

      for (const mem of memories.slice(0, MAX_MEMORIES)) {
        sources.push({
          id: `memory:${mem.id}`,
          label: trimLabel(mem.text),
          category: "Memory",
          resolve: () => ({
            id: mem.id,
            text: mem.text,
            category: mem.category,
            scope: mem.scope,
          }),
        });
      }

      for (const agent of agentsRes.agents) {
        if (agent.id === agentId || agent.isTemplate || !agent.enabled) continue;
        sources.push({
          id: `agent:${agent.id}`,
          label: agent.name,
          category: "Agents",
          resolve: () => ({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            backend: agent.backend,
          }),
        });
      }

      try {
        const repoPaths = await fetchRepoMentionPaths();
        for (const p of repoPaths.paths.slice(0, 60)) {
          const isDir = p.type === "dir";
          sources.push({
            id: isDir ? `folder:${p.path}` : `file:${p.path}`,
            label: p.path,
            category: isDir ? "Folders" : "Files",
            resolve: () =>
              isDir
                ? { folder: p.path, note: "Folder path attached for context" }
                : {
                    file: p.path,
                    note: "Use read_file for full contents when implementing",
                  },
          });
        }
      } catch {
        /* code access may be unavailable */
      }

      if (cancelled) return;
      for (const src of sources) {
        cleanups.push(registerMentionSource(src));
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [agentId, enabled, pageKey, registerMentionSource, pageSnapshot]);
}
