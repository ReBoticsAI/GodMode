import { useEffect, useMemo, useState } from "react";
import { HashIcon, MessageCircleIcon, SearchIcon, UsersIcon } from "lucide-react";
import {
  createDmConversation,
  fetchDmContacts,
  type DmContact,
  type DmConversation,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { unreadCountsByKind } from "@/lib/chat-windows";
import { useIntelligence } from "@/lib/intelligence-context";
import { cn } from "@/lib/utils";

/**
 * DMs / Channels inbox with search + unread.
 * Contacts appear in search (start/open DM). Selecting a row opens a thread window.
 * When `embedded`, renders as FloatingWindow body content (no outer chrome).
 */
export function ChatInboxPanel({
  composerText,
  className,
  embedded = false,
  onComposerDraftChange,
}: {
  composerText: string;
  className?: string;
  embedded?: boolean;
  onComposerDraftChange?: (text: string) => void;
}) {
  const {
    dmConversations,
    refreshDmConversations,
    openOrFocusChatWindow,
    setChatInboxOpen,
    focusChatWindow,
  } = useIntelligence();
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<DmContact[]>([]);
  const [segment, setSegment] = useState<"dms" | "channels">("dms");

  useEffect(() => {
    void refreshDmConversations();
    void fetchDmContacts()
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
  }, [refreshDmConversations]);

  const counts = useMemo(
    () => unreadCountsByKind(dmConversations),
    [dmConversations]
  );

  const q = query.trim().toLowerCase();

  const filteredConversations = useMemo(() => {
    return dmConversations.filter((c) => {
      if (segment === "dms" && c.kind === "group") return false;
      if (segment === "channels" && c.kind !== "group") return false;
      if (!q) return true;
      return (c.title || "").toLowerCase().includes(q);
    });
  }, [dmConversations, q, segment]);

  const filteredContacts = useMemo(() => {
    if (segment !== "dms") return [];
    if (!q) return contacts.slice(0, 8);
    return contacts
      .filter(
        (c) =>
          c.displayName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [contacts, q, segment]);

  const openConversation = (c: DmConversation) => {
    const id = openOrFocusChatWindow(
      {
        kind: c.kind === "group" ? "channel" : "dm",
        conversationId: c.id,
        title: c.title || (c.kind === "group" ? "Channel" : "Direct message"),
      },
      composerText
    );
    const restored = focusChatWindow(id, composerText);
    onComposerDraftChange?.(restored);
  };

  const openContact = async (contact: DmContact) => {
    const res = await createDmConversation({
      kind: "direct",
      memberUserIds: [contact.id],
    });
    await refreshDmConversations();
    const id = openOrFocusChatWindow(
      {
        kind: "dm",
        conversationId: res.conversation.id,
        title: res.conversation.title || contact.displayName || contact.email,
      },
      composerText
    );
    const restored = focusChatWindow(id, composerText);
    onComposerDraftChange?.(restored);
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden",
        !embedded &&
          "max-h-[min(40vh,22rem)] w-full rounded-xl border border-border/60 bg-card/95 shadow-lg backdrop-blur-md",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <SearchIcon className="size-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search DMs, channels, contacts…"
          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
          aria-label="Search DMs and channels"
        />
        {!embedded ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs"
            onClick={() => setChatInboxOpen(false)}
          >
            Close
          </Button>
        ) : null}
      </div>

      <Tabs
        value={segment}
        onValueChange={(v) => setSegment(v as "dms" | "channels")}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList className="h-9 w-full justify-start rounded-none border-b bg-transparent px-2">
          <TabsTrigger value="dms" className="gap-1.5 text-xs">
            <MessageCircleIcon className="size-3.5" />
            DMs
            {counts.dms > 0 ? (
              <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">
                {counts.dms}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="channels" className="gap-1.5 text-xs">
            <HashIcon className="size-3.5" />
            Channels
            {counts.channels > 0 ? (
              <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">
                {counts.channels}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="dms"
          className="mt-0 min-h-0 flex-1 overflow-y-auto p-0 data-[state=inactive]:hidden"
        >
          <InboxList
            conversations={filteredConversations}
            contacts={filteredContacts}
            onSelectConversation={openConversation}
            onSelectContact={(c) => void openContact(c)}
          />
        </TabsContent>
        <TabsContent
          value="channels"
          className="mt-0 min-h-0 flex-1 overflow-y-auto p-0 data-[state=inactive]:hidden"
        >
          <InboxList
            conversations={filteredConversations}
            contacts={[]}
            onSelectConversation={openConversation}
            onSelectContact={() => undefined}
            emptyLabel="No channels yet"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InboxList({
  conversations,
  contacts,
  onSelectConversation,
  onSelectContact,
  emptyLabel = "No conversations",
}: {
  conversations: DmConversation[];
  contacts: DmContact[];
  onSelectConversation: (c: DmConversation) => void;
  onSelectContact: (c: DmContact) => void;
  emptyLabel?: string;
}) {
  if (conversations.length === 0 && contacts.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">{emptyLabel}</p>
    );
  }

  return (
    <ul className="py-1">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
            onClick={() => onSelectConversation(c)}
          >
            {c.kind === "group" ? (
              <HashIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <MessageCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {c.title || (c.kind === "group" ? "Channel" : "Direct message")}
            </span>
            {c.unreadCount > 0 ? (
              <Badge className="h-4 min-w-4 px-1 text-[10px]">{c.unreadCount}</Badge>
            ) : null}
          </button>
        </li>
      ))}
      {contacts.length > 0 ? (
        <li className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Contacts
        </li>
      ) : null}
      {contacts.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
            onClick={() => onSelectContact(c)}
          >
            <UsersIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {c.displayName || c.email}
            </span>
            <span className="truncate text-[10px] text-muted-foreground">
              {c.email}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
