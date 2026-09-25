import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BotIcon,
  HashIcon,
  MessageCircleIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  createDmConversation,
  fetchDmContacts,
  type DmContact,
  type DmConversation,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatTarget } from "@/lib/intelligence-context";
import { cn } from "@/lib/utils";

export function ChatDirectorySidebar({
  agentId,
  agentName,
  chatTarget,
  conversations,
  className,
  onSelectAgent,
  onSelectConversation,
  onCreated,
}: {
  agentId: string;
  agentName: string;
  chatTarget: ChatTarget;
  conversations: DmConversation[];
  className?: string;
  onSelectAgent: () => void;
  onSelectConversation: (conversationId: string) => void;
  onCreated: () => void;
}) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<DmContact[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [email, setEmail] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchDmContacts()
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
  }, []);

  const q = query.trim().toLowerCase();

  const directMessages = useMemo(
    () =>
      conversations.filter((c) => {
        if (c.kind === "group") return false;
        if (!q) return true;
        return (c.displayTitle || c.title || "").toLowerCase().includes(q);
      }),
    [conversations, q]
  );

  const channels = useMemo(
    () =>
      conversations.filter((c) => {
        if (c.kind !== "group") return false;
        if (!q) return true;
        return (c.displayTitle || c.title || "").toLowerCase().includes(q);
      }),
    [conversations, q]
  );

  const filteredContacts = useMemo(() => {
    if (!q) return [];
    return contacts.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [contacts, q]);

  const agentSelected =
    chatTarget.kind === "agent" && chatTarget.agentId === agentId;
  const showAgent = !q || agentName.toLowerCase().includes(q);

  const startWithEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const found = await fetchDmContacts(trimmed);
      const contact = found.contacts.find(
        (c) => c.email.toLowerCase() === trimmed.toLowerCase()
      );
      if (!contact) {
        toast.error("No contact found for that email");
        return;
      }
      const title = groupTitle.trim();
      const res = await createDmConversation({
        kind: title ? "group" : "direct",
        title: title || undefined,
        memberUserIds: [contact.id],
      });
      onCreated();
      onSelectConversation(res.conversation.id);
      setShowNew(false);
      setEmail("");
      setGroupTitle("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start chat");
    } finally {
      setBusy(false);
    }
  };

  const startWithContact = async (contact: DmContact) => {
    setBusy(true);
    try {
      const res = await createDmConversation({
        kind: "direct",
        memberUserIds: [contact.id],
      });
      onCreated();
      onSelectConversation(res.conversation.id);
      setQuery("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start chat");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      aria-label="Conversations"
      className={cn(
        "flex h-full min-h-0 w-56 shrink-0 flex-col border-r bg-background",
        className
      )}
    >
      <div className="flex items-center gap-1 border-b p-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search channels, direct messages, and contacts"
            className="h-8 pl-7"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="New conversation"
          aria-expanded={showNew}
          onClick={() => setShowNew((open) => !open)}
        >
          <PlusIcon />
        </Button>
      </div>

      {showNew ? (
        <form
          className="border-b p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void startWithEmail();
          }}
        >
          <FieldGroup className="gap-2">
            <Field>
              <FieldLabel htmlFor="chat-directory-email">Email</FieldLabel>
              <Input
                id="chat-directory-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="chat-directory-channel">
                Channel name
              </FieldLabel>
              <Input
                id="chat-directory-channel"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="Optional"
                autoComplete="off"
              />
            </Field>
            <Button
              type="submit"
              size="sm"
              className="w-full"
              disabled={busy || !email.trim()}
            >
              Start chat
            </Button>
          </FieldGroup>
        </form>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-1 py-2">
          {showAgent ? (
            <section className="flex flex-col gap-0.5">
              <DirectoryRow
                label={agentName}
                icon={<BotIcon className="size-3.5 shrink-0" />}
                selected={agentSelected}
                onClick={onSelectAgent}
              />
            </section>
          ) : null}

          {q ? (
            <DirectorySection title="Contacts">
              {filteredContacts.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  No contacts
                </p>
              ) : (
                filteredContacts.map((c) => (
                  <DirectoryRow
                    key={c.id}
                    label={c.displayName || c.email}
                    icon={<UsersIcon className="size-3.5 shrink-0" />}
                    disabled={busy}
                    onClick={() => void startWithContact(c)}
                  />
                ))
              )}
            </DirectorySection>
          ) : null}

          <DirectorySection title="Channels">
            {channels.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No channels yet
              </p>
            ) : (
              channels.map((c) => (
                <DirectoryRow
                  key={c.id}
                  label={c.displayTitle || c.title || "Channel"}
                  icon={<HashIcon className="size-3.5 shrink-0" />}
                  unread={c.unreadCount}
                  selected={
                    chatTarget.kind === "conversation" &&
                    chatTarget.conversationId === c.id
                  }
                  onClick={() => onSelectConversation(c.id)}
                />
              ))
            )}
          </DirectorySection>

          <DirectorySection title="Direct messages">
            {directMessages.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No direct messages
              </p>
            ) : (
              directMessages.map((c) => (
                <DirectoryRow
                  key={c.id}
                  label={c.displayTitle || c.title || "Direct message"}
                  icon={<MessageCircleIcon className="size-3.5 shrink-0" />}
                  unread={c.unreadCount}
                  selected={
                    chatTarget.kind === "conversation" &&
                    chatTarget.conversationId === c.id
                  }
                  onClick={() => onSelectConversation(c.id)}
                />
              ))
            )}
          </DirectorySection>
        </div>
      </ScrollArea>
    </aside>
  );
}

function DirectorySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      <p className="px-2 text-xs font-medium text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

function DirectoryRow({
  label,
  icon,
  unread = 0,
  selected = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  unread?: number;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50",
        selected && "bg-muted"
      )}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {unread > 0 ? (
        <Badge className="h-4 min-w-4 px-1 text-[10px]">{unread}</Badge>
      ) : null}
    </button>
  );
}
