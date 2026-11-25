import { useState } from "react";
import {
  BookOpenIcon,
  CheckSquareIcon,
  UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { useIntelligence } from "@/lib/intelligence-context";
import { useIsPhone } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type ContextTab = "members" | "knowledge" | "approvals";

function ContextBody({ tab }: { tab: ContextTab }) {
  const { setPanelTab, chatTarget } = useIntelligence();

  if (tab === "knowledge") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <p className="text-sm text-muted-foreground">
          Rules, skills, memory, and tools for the active agent live here. Open
          the full Knowledge surface from chat when you need to edit.
        </p>
        <Button
          variant="outline"
          onClick={() => setPanelTab("knowledge")}
        >
          Open Knowledge
        </Button>
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Context for this chat</EmptyTitle>
            <EmptyDescription>
              {chatTarget.kind === "agent"
                ? `Agent target: ${chatTarget.agentId}`
                : chatTarget.kind === "conversation"
                  ? `Conversation: ${chatTarget.conversationId}`
                  : "Pick a channel, DM, or agent."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  if (tab === "approvals") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <p className="text-sm text-muted-foreground">
          Tool approval cards appear inline in the transcript. Use this rail for
          a running list in a later pass.
        </p>
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No pending approvals</EmptyTitle>
            <EmptyDescription>
              When Buddy asks to use a tool, the card shows in chat.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>Members</EmptyTitle>
          <EmptyDescription>
            Channel and DM member lists land here next. API already supports
            conversation members.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

function ContextPanel({
  tab,
  onTabChange,
  className,
}: {
  tab: ContextTab;
  onTabChange: (tab: ContextTab) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-sidebar", className)}>
      <div className="flex h-12 items-center px-3">
        <span className="text-sm font-medium">Context</span>
      </div>
      <Separator />
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as ContextTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-2 mt-2 grid w-auto grid-cols-3">
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
        </TabsList>
        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="members" className="m-0">
            <ContextBody tab="members" />
          </TabsContent>
          <TabsContent value="knowledge" className="m-0">
            <ContextBody tab="knowledge" />
          </TabsContent>
          <TabsContent value="approvals" className="m-0">
            <ContextBody tab="approvals" />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

export function ChatContextRail() {
  const isPhone = useIsPhone();
  const [tab, setTab] = useState<ContextTab>("knowledge");
  const [open, setOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<ContextTab>("knowledge");

  if (isPhone) {
    return (
      <>
        <div className="flex items-center gap-1 border-t bg-background p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSheetTab("members");
              setOpen(true);
            }}
          >
            <UsersIcon data-icon="inline-start" />
            Members
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSheetTab("knowledge");
              setOpen(true);
            }}
          >
            <BookOpenIcon data-icon="inline-start" />
            Knowledge
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSheetTab("approvals");
              setOpen(true);
            }}
          >
            <CheckSquareIcon data-icon="inline-start" />
            Approvals
          </Button>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" className="w-[92vw] max-w-md p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Context</SheetTitle>
            </SheetHeader>
            <ContextPanel tab={sheetTab} onTabChange={setSheetTab} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <aside className="hidden w-72 shrink-0 border-l bg-sidebar md:flex md:flex-col">
      <ContextPanel tab={tab} onTabChange={setTab} />
    </aside>
  );
}
