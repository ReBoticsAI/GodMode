import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cloneAiAgent, deleteAiAgent, fetchAiAgents } from "@/api";
import { useIntelligence, type AgentsSection } from "@/lib/intelligence-context";
import { useStructure } from "@/lib/structure-context";
import { useTenant } from "@/lib/tenant-context";
import { userAgentIdForUser, isUserAgentId } from "@/lib/structure-agents";
import { Button } from "@/components/ui/button";
import { AgentTreePalette } from "./AgentTreePalette";
import { filterAgentsToStructure } from "./agent-org";
import { AgentsOrgChart } from "./AgentsOrgChart";
import { AiBuilder } from "./AiBuilder";
import { ActivityPanel } from "./ActivityPanel";
import { AutomationsPanel } from "@/pages/Automations";

const ROOT_ID = "intelligence";

const SECTIONS: Array<{ id: AgentsSection; label: string }> = [
  { id: "organization", label: "Organization" },
  { id: "pipeline", label: "Pipeline" },
  { id: "workflows", label: "Automations" },
  { id: "activity", label: "Activity" },
];

export function AgentsWorkspace() {
  const { activeAgentId, setActiveAgentId, agentsSection, setAgentsSection } =
    useIntelligence();
  const { departments } = useStructure();
  const { user } = useTenant();
  const personaId = user ? userAgentIdForUser(user.id) : null;
  const [searchParams] = useSearchParams();
  const [allAgents, setAllAgents] = useState<
    Awaited<ReturnType<typeof fetchAiAgents>>["agents"]
  >([]);
  const agents = useMemo(
    () =>
      filterAgentsToStructure(allAgents).filter(
        (a) => !isUserAgentId(a.id) || a.id === personaId
      ),
    [allAgents, departments, personaId]
  );
  const paletteRootId = ROOT_ID;
  const protectedIds = useMemo(() => {
    const ids = new Set<string>([ROOT_ID]);
    if (personaId) ids.add(personaId);
    return ids;
  }, [personaId]);
  const [agentsVersion, setAgentsVersion] = useState(0);

  useEffect(() => {
    const section = searchParams.get("section");
    if (
      section === "organization" ||
      section === "pipeline" ||
      section === "workflows" ||
      section === "activity"
    ) {
      setAgentsSection(section);
    }
  }, [searchParams, setAgentsSection]);

  const loadAgents = useCallback(() => {
    fetchAiAgents()
      .then((r) => setAllAgents(r.agents))
      .catch(() => setAllAgents([]));
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents, agentsVersion]);

  const childCount = useMemo(
    () => agents.filter((a) => a.id !== ROOT_ID).length,
    [agents]
  );

  const bumpAgents = useCallback(() => {
    loadAgents();
    setAgentsVersion((v) => v + 1);
  }, [loadAgents]);

  const handleAdd = useCallback(() => {
    void cloneAiAgent(ROOT_ID, `Subagent ${childCount + 1}`).then((a) => {
      bumpAgents();
      setActiveAgentId(a.id);
    });
  }, [childCount, bumpAgents, setActiveAgentId]);

  const handleDelete = useCallback(
    (id: string) => {
      if (id === ROOT_ID) return;
      void deleteAiAgent(id).then(() => {
        bumpAgents();
        if (activeAgentId === id) setActiveAgentId(ROOT_ID);
      });
    },
    [activeAgentId, bumpAgents, setActiveAgentId]
  );

  const palette = (
    <AgentTreePalette
      agents={agents}
      rootId={paletteRootId}
      selectedAgentId={activeAgentId}
      onSelect={setActiveAgentId}
      onDelete={handleDelete}
      onAdd={handleAdd}
      protectedIds={protectedIds}
    />
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2">
        {SECTIONS.map(({ id, label }) => (
          <Button
            key={id}
            type="button"
            variant={agentsSection === id ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => setAgentsSection(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {agentsSection === "organization" && (
          <>
            {palette}
            <div className="relative min-h-0 min-w-0 flex-1">
              <AgentsOrgChart embedded agentsVersion={agentsVersion} />
            </div>
          </>
        )}

        {agentsSection === "pipeline" && (
          <AiBuilder embedded agentsVersion={agentsVersion} />
        )}

        {agentsSection === "workflows" && (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <AutomationsPanel />
          </div>
        )}

        {agentsSection === "activity" && (
          <>
            {palette}
            <div className="min-h-0 min-w-0 flex-1">
              <ActivityPanel />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
