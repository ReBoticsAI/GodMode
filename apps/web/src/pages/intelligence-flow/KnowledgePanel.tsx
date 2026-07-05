import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RulesTab } from "@/pages/ai-settings/RulesTab";
import { SkillsTab } from "@/pages/ai-settings/SkillsTab";
import { MemoryTab } from "@/pages/ai-settings/MemoryTab";
import { ArtifactsTab } from "@/pages/ai-settings/ArtifactsTab";
import { ReflectionPanel } from "./ReflectionPanel";
import { ToolsTab } from "@/pages/ai-settings/ToolsTab";
import { useIntelligence, type KnowledgeSubTab } from "@/lib/intelligence-context";

export function KnowledgePanel() {
  const { knowledgeSubTab, setKnowledgeSubTab } = useIntelligence();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Tabs
        value={knowledgeSubTab}
        onValueChange={(v) => setKnowledgeSubTab(v as KnowledgeSubTab)}
        className="shrink-0 border-b px-3 pt-2"
      >
        <TabsList variant="line" className="h-8 w-full justify-start">
          <TabsTrigger value="rules" className="text-xs">
            Rules
          </TabsTrigger>
          <TabsTrigger value="skills" className="text-xs">
            Skills
          </TabsTrigger>
          <TabsTrigger value="memory" className="text-xs">
            Memory
          </TabsTrigger>
          <TabsTrigger value="artifacts" className="text-xs">
            Artifacts
          </TabsTrigger>
          <TabsTrigger value="reflection" className="text-xs">
            Reflection
          </TabsTrigger>
          <TabsTrigger value="tools" className="text-xs">
            Tools
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {knowledgeSubTab === "rules" && <RulesTab />}
          {knowledgeSubTab === "skills" && <SkillsTab />}
          {knowledgeSubTab === "memory" && <MemoryTab />}
          {knowledgeSubTab === "artifacts" && <ArtifactsTab />}
          {knowledgeSubTab === "reflection" && <ReflectionPanel />}
          {knowledgeSubTab === "tools" && <ToolsTab />}
        </div>
      </ScrollArea>
    </div>
  );
}
