import { MessageCircleIcon } from "lucide-react";
import { FloatingWindow } from "@/components/floating/FloatingWindow";
import { ChatInboxPanel } from "@/components/chat/ChatInboxPanel";
import { useIntelligence } from "@/lib/intelligence-context";

const INBOX_WINDOW_ID = "chat-inbox";

/**
 * DM / Channel search in the same FloatingWindow shell as Node Information.
 * Position and size persist via FloatingWindow + windowId.
 */
export function ChatInboxWindow({
  composerText,
  onComposerDraftChange,
}: {
  composerText: string;
  onComposerDraftChange?: (text: string) => void;
}) {
  const {
    chatInboxOpen,
    setChatInboxOpen,
    chatInboxMinimized,
    setChatInboxMinimized,
  } = useIntelligence();

  return (
    <FloatingWindow
      open={chatInboxOpen}
      minimized={chatInboxMinimized}
      onMinimize={() => setChatInboxMinimized(true)}
      title="Messages"
      icon={<MessageCircleIcon className="size-4" style={{ color: "#38bdf8" }} />}
      accent="#38bdf8"
      windowId={INBOX_WINDOW_ID}
      role="generic"
      placement="focus-right"
      defaultWidth={380}
      defaultHeight={480}
      minWidth={300}
      minHeight={280}
      onClose={() => {
        setChatInboxOpen(false);
        setChatInboxMinimized(false);
      }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <ChatInboxPanel
          composerText={composerText}
          onComposerDraftChange={onComposerDraftChange}
          embedded
        />
      </div>
    </FloatingWindow>
  );
}
