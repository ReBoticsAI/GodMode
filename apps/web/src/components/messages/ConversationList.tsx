import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createDmConversation, type DmContact, type DmConversation } from "@/api";

interface ConversationListProps {
  conversations: DmConversation[];
  contacts: DmContact[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreated: (conversation: DmConversation) => void;
}

export function ConversationList({
  conversations,
  contacts,
  activeId,
  onSelect,
  onCreated,
}: ConversationListProps) {
  const [showNew, setShowNew] = useState(false);
  const [email, setEmail] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const startDirect = async (contact: DmContact) => {
    setBusy(true);
    try {
      const res = await createDmConversation({
        kind: "direct",
        memberUserIds: [contact.id],
      });
      onCreated(res.conversation);
      onSelect(res.conversation.id);
      setShowNew(false);
    } finally {
      setBusy(false);
    }
  };

  const startByEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await createDmConversation({
        kind: groupTitle.trim() ? "group" : "direct",
        title: groupTitle.trim() || undefined,
        memberEmails: [trimmed],
      });
      onCreated(res.conversation);
      onSelect(res.conversation.id);
      setShowNew(false);
      setEmail("");
      setGroupTitle("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col border-r">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Messages</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setShowNew((v) => !v)}
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>

      {showNew ? (
        <div className="border-b p-3 space-y-2">
          <Input
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            placeholder="Group title (optional)"
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={busy || !email.trim()}
            onClick={() => void startByEmail()}
          >
            Start chat
          </Button>
          {contacts.length > 0 ? (
            <div className="space-y-1 pt-1">
              <p className="text-[10px] text-muted-foreground uppercase">Contacts</p>
              {contacts.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
                  onClick={() => void startDirect(c)}
                  disabled={busy}
                >
                  <span className="inline-flex items-center gap-1">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        c.online ? "bg-emerald-500" : "bg-muted-foreground/40"
                      )}
                    />
                    {c.displayName}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">No conversations yet.</p>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cn(
                "w-full border-b px-3 py-2 text-left hover:bg-muted/50",
                activeId === c.id && "bg-muted"
              )}
              onClick={() => onSelect(c.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{c.displayTitle}</span>
                {c.unreadCount > 0 ? (
                  <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                    {c.unreadCount}
                  </span>
                ) : null}
              </div>
              {c.lastMessagePreview ? (
                <p className="truncate text-xs text-muted-foreground">
                  {c.lastMessagePreview}
                </p>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
