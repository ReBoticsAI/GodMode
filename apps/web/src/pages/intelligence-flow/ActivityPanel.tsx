import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MemoryEngineTab } from "@/pages/ai-settings/MemoryEngineTab";
import { QueueTab } from "@/pages/ai-settings/QueueTab";
import { SchedulesTab } from "@/pages/ai-settings/SchedulesTab";

type ActivityTab = "memory" | "queue" | "schedules";

export function ActivityPanel() {
  const [tab, setTab] = useState<ActivityTab>("memory");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as ActivityTab)}
        className="shrink-0 border-b px-3 pt-2"
      >
        <TabsList variant="line" className="h-8 w-full justify-start">
          <TabsTrigger value="memory" className="text-xs">
            Memory
          </TabsTrigger>
          <TabsTrigger value="queue" className="text-xs">
            Queue
          </TabsTrigger>
          <TabsTrigger value="schedules" className="text-xs">
            Schedules
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {tab === "memory" && <MemoryEngineTab />}
          {tab === "queue" && <QueueTab />}
          {tab === "schedules" && <SchedulesTab />}
        </div>
      </ScrollArea>
    </div>
  );
}
