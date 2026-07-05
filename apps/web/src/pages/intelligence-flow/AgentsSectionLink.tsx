import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AGENTS_PATH } from "@/lib/navigation";
import { useIntelligence, type AgentsSection } from "@/lib/intelligence-context";

export function AgentsSectionLink({
  section,
  label,
}: {
  section: AgentsSection;
  label: string;
}) {
  const navigate = useNavigate();
  const { setAgentsSection } = useIntelligence();

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">
        Edit {label.toLowerCase()} in Agents → {sectionLabel(section)}.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit text-xs"
        onClick={() => {
          setAgentsSection(section);
          navigate(`${AGENTS_PATH}?section=${section}`);
        }}
      >
        Open {sectionLabel(section)}
      </Button>
    </div>
  );
}

function sectionLabel(section: AgentsSection): string {
  switch (section) {
    case "organization":
      return "Organization";
    case "pipeline":
      return "Pipeline";
    case "workflows":
      return "Automations";
    case "activity":
      return "Activity";
  }
}

/** Opens the Chat window's Knowledge tab, where Rules/Skills/Memory now live. */
export function KnowledgePanelLink({ label }: { label: string }) {
  const { openPanel } = useIntelligence();

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">
        Edit {label.toLowerCase()} in the Chat window → Knowledge.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit text-xs"
        onClick={() => openPanel({ tab: "knowledge" })}
      >
        Open Knowledge
      </Button>
    </div>
  );
}
