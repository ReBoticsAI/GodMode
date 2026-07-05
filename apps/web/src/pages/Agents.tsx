import { AgentsWorkspace } from "@/pages/intelligence-flow/AgentsWorkspace";
import { Page, PageHeader } from "@/components/PageHeader";

export default function AgentsPage() {
  return (
    <Page className="flex h-[calc(100dvh-7rem)] max-w-none flex-col gap-4">
      <PageHeader
        title="Agents"
        description="Organization chart, agent pipeline, knowledge, workflows, and activity."
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <AgentsWorkspace />
      </div>
    </Page>
  );
}
