import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BotIcon,
  CloudIcon,
  HashIcon,
  InfoIcon,
  MessageCircleIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  createDmConversation,
  fetchDmContacts,
  type DmContact,
  type DmConversation,
  type PublicChannelRow,
  type PublicChatEntitlement,
} from "@/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { ChatTarget } from "@/lib/intelligence-context";
import { cn } from "@/lib/utils";

export type AgentDmRow = {
  agentId: string;
  label: string;
};

function channelLabel(channel: PublicChannelRow): string {
  const slug = channel.slug?.trim();
  if (slug) return slug;
  return (channel.displayTitle || channel.title || "channel").replace(/^#/, "");
}

export function ChatDirectorySidebar({
  agentId,
  agentName,
  agentRows,
  chatTarget,
  conversations,
  installChannels,
  cloudChannels,
  cloudLobbyOnline,
  entitlement,
  className,
  onSelectAgent,
  onSelectConversation,
  onSelectCloudChannel,
  onCreated,
}: {
  agentId: string;
  agentName: string;
  /** Local agents shown as DMs (Intelligence, Digital You, …). */
  agentRows: AgentDmRow[];
  chatTarget: ChatTarget;
  conversations: DmConversation[];
  installChannels: PublicChannelRow[];
  cloudChannels: PublicChannelRow[];
  cloudLobbyOnline: boolean;
  entitlement: PublicChatEntitlement | null;
  className?: string;
  onSelectAgent: (agentId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onSelectCloudChannel: (slug: string) => void;
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

  const privateDirects = useMemo(
    () =>
      conversations.filter((c) => {
        if (c.kind !== "direct") return false;
        if (!q) return true;
        return (c.displayTitle || c.title || "").toLowerCase().includes(q);
      }),
    [conversations, q]
  );

  const privateGroups = useMemo(
    () =>
      conversations.filter((c) => {
        if (c.kind !== "group") return false;
        if (!q) return true;
        return (c.displayTitle || c.title || "").toLowerCase().includes(q);
      }),
    [conversations, q]
  );

  const filteredInstall = useMemo(
    () =>
      installChannels.filter((c) =>
        !q
          ? true
          : c.displayTitle.toLowerCase().includes(q) || c.slug.includes(q)
      ),
    [installChannels, q]
  );

  const filteredCloud = useMemo(
    () =>
      cloudChannels.filter((c) =>
        !q
          ? true
          : c.displayTitle.toLowerCase().includes(q) || c.slug.includes(q)
      ),
    [cloudChannels, q]
  );

  const filteredAgents = useMemo(
    () =>
      agentRows.filter((a) =>
        !q ? true : a.label.toLowerCase().includes(q)
      ),
    [agentRows, q]
  );

  const filteredContacts = useMemo(() => {
    if (!q) return [];
    return contacts.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [contacts, q]);

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

  const cloudSelectedSlug =
    chatTarget.kind === "conversation" &&
    cloudChannels.some((c) => c.id === chatTarget.conversationId)
      ? cloudChannels.find((c) => c.id === chatTarget.conversationId)?.slug
      : null;

  return (
    <aside
      aria-label="Conversations"
      className={cn(
        "flex h-full min-h-0 w-56 shrink-0 flex-col border-r bg-background",
        className
      )}
    >
      <div className="flex items-center gap-1 border-b p-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon align="inline-start">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search channels, direct messages, and contacts"
          />
        </InputGroup>
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
                Private group name
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

      {!entitlement?.ok ? (
        <div className="border-b p-2">
          <Alert className="py-1.5 text-xs">
            <InfoIcon />
            <AlertDescription className="text-xs text-muted-foreground">
              Public channels are read-only until Cloud, Seller, or paid
              Inference.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-1.5">
          <DirectorySection
            title="Cloud"
            icon={<CloudIcon />}
          >
            {!cloudLobbyOnline && filteredCloud.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                Cloud lobby offline
              </p>
            ) : filteredCloud.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No channels
              </p>
            ) : (
              filteredCloud.map((c) => (
                <DirectoryRow
                  key={`cloud-${c.slug}`}
                  label={channelLabel(c)}
                  icon={<HashIcon data-icon="inline-start" />}
                  unread={c.unreadCount}
                  selected={
                    (chatTarget.kind === "conversation" &&
                      chatTarget.conversationId === c.id) ||
                    cloudSelectedSlug === c.slug
                  }
                  onClick={() => onSelectCloudChannel(c.slug)}
                />
              ))
            )}
          </DirectorySection>

          <Separator className="my-1" />

          <DirectorySection
            title="This install"
            icon={<ServerIcon />}
          >
            {filteredInstall.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No channels
              </p>
            ) : (
              filteredInstall.map((c) => (
                <DirectoryRow
                  key={`install-${c.id}`}
                  label={channelLabel(c)}
                  icon={<HashIcon data-icon="inline-start" />}
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

          <Separator className="my-1" />

          <DirectorySection title="Direct messages">
            {filteredAgents.map((a) => (
              <DirectoryRow
                key={`agent-${a.agentId}`}
                label={a.label}
                icon={<BotIcon data-icon="inline-start" />}
                selected={
                  chatTarget.kind === "agent" &&
                  chatTarget.agentId === a.agentId
                }
                onClick={() => onSelectAgent(a.agentId)}
              />
            ))}
            {privateDirects.map((c) => (
              <DirectoryRow
                key={c.id}
                label={c.displayTitle || c.title || "Direct message"}
                icon={<MessageCircleIcon data-icon="inline-start" />}
                unread={c.unreadCount}
                selected={
                  chatTarget.kind === "conversation" &&
                  chatTarget.conversationId === c.id
                }
                onClick={() => onSelectConversation(c.id)}
              />
            ))}
            {privateGroups.map((c) => (
              <DirectoryRow
                key={c.id}
                label={c.displayTitle || c.title || "Group"}
                icon={<UsersIcon data-icon="inline-start" />}
                unread={c.unreadCount}
                selected={
                  chatTarget.kind === "conversation" &&
                  chatTarget.conversationId === c.id
                }
                onClick={() => onSelectConversation(c.id)}
              />
            ))}
            {filteredAgents.length === 0 &&
            privateDirects.length === 0 &&
            privateGroups.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No direct messages
              </p>
            ) : null}
          </DirectorySection>

          {q ? (
            <>
              <Separator className="my-1" />
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
                      icon={<UsersIcon data-icon="inline-start" />}
                      disabled={busy}
                      onClick={() => void startWithContact(c)}
                    />
                  ))
                )}
              </DirectorySection>
            </>
          ) : null}

          {!filteredAgents.some((a) => a.agentId === agentId) &&
          (!q || agentName.toLowerCase().includes(q)) ? (
            <>
              <Separator className="my-1" />
              <DirectorySection title="Agents">
                <DirectoryRow
                  label={agentName}
                  icon={<BotIcon data-icon="inline-start" />}
                  selected={
                    chatTarget.kind === "agent" && chatTarget.agentId === agentId
                  }
                  onClick={() => onSelectAgent(agentId)}
                />
              </DirectorySection>
            </>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}

function DirectorySection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground [&_svg]:size-3">
        {icon}
        <span>{title}</span>
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
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
    <Button
      type="button"
      variant={selected ? "secondary" : "ghost"}
      size="sm"
      disabled={disabled}
      aria-current={selected ? "true" : undefined}
      className="h-8 w-full justify-start px-2 font-normal"
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {unread > 0 ? (
        <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">
          {unread}
        </Badge>
      ) : null}
    </Button>
  );
}
