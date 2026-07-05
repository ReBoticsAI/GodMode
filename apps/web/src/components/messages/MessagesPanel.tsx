import { useEffect, useState } from "react";
import { MessageCircleIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { fetchDmContacts, type DmContact, type DmConversation } from "@/api";
import { useMessages } from "@/lib/messages-context";
import { ConversationList } from "./ConversationList";
import { MessageThread } from "./MessageThread";

export function MessagesPanel() {
  const {
    panelOpen,
    setPanelOpen,
    activeConversationId,
    setActiveConversationId,
    conversations,
    refreshConversations,
  } = useMessages();
  const [contacts, setContacts] = useState<DmContact[]>([]);

  useEffect(() => {
    if (!panelOpen) return;
    void fetchDmContacts()
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
    void refreshConversations();
  }, [panelOpen, refreshConversations]);

  const handleCreated = (conversation: DmConversation) => {
    void refreshConversations();
    setActiveConversationId(conversation.id);
  };

  return (
    <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 flex flex-col gap-0"
      >
        <SheetTitle className="sr-only">Messages</SheetTitle>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <MessageCircleIcon className="size-4" />
            Messages
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setPanelOpen(false)}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-64 shrink-0">
            <ConversationList
              conversations={conversations}
              contacts={contacts}
              activeId={activeConversationId}
              onSelect={setActiveConversationId}
              onCreated={handleCreated}
            />
          </div>
          <div className="flex flex-1 min-w-0">
            {activeConversationId ? (
              <MessageThread conversationId={activeConversationId} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Select a conversation or start a new chat
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
