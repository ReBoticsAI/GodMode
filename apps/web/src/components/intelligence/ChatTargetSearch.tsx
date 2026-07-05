import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BotIcon,
  ChevronDownIcon,
  MessageCircleIcon,
  SearchIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIntelligence } from "@/lib/intelligence-context";
import { useStructure } from "@/lib/structure-context";
import { departmentFromPath, divisionFromPath } from "@/lib/navigation";
import {
  createDmConversation,
  fetchAiAgents,
  fetchActiveAgents,
  fetchDmContacts,
  getActiveTenantId,
  resolveAgentForPage,
  type AiAgent,
  type DmContact,
} from "@/api";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isChatTargetAgent } from "@/lib/chat-target-agents";

/**
 * Unified chat target selector: agents, human contacts, existing conversations,
 * and mixed group creation.
 */
export function ChatTargetSearch({
  titleMode = false,
}: {
  /** Render the trigger as the prominent panel title (larger, no leading icon). */
  titleMode?: boolean;
} = {}) {
  const {
    chatTarget,
    setChatTarget,
    activeAgentId,
    dmConversations,
    refreshDmConversations,
    pathname,
  } = useIntelligence();
  const { departments } = useStructure();
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [contacts, setContacts] = useState<DmContact[]>([]);
  const [responsible, setResponsible] = useState<{
    agent: AiAgent;
    inheritedFrom: string;
  } | null>(null);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupAgentIds, setGroupAgentIds] = useState<Set<string>>(new Set());
  const [groupContactIds, setGroupContactIds] = useState<Set<string>>(new Set());
  const [groupBusy, setGroupBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchAiAgents()
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
    fetchDmContacts()
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
  }, []);

  useEffect(() => {
    const poll = () => {
      fetchActiveAgents()
        .then((r) => setActiveIds(new Set(r.activeAgentIds)))
        .catch(() => undefined);
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchAiAgents()
      .then((r) => setAgents(r.agents))
      .catch(() => undefined);
    fetchDmContacts()
      .then((r) => setContacts(r.contacts))
      .catch(() => undefined);
    void refreshDmConversations();
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, refreshDmConversations]);

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as globalThis.Node | null;
      if (
        panelRef.current?.contains(t) ||
        triggerRef.current?.contains(t as globalThis.Node)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScrollResize = () => setOpen(false);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onScrollResize);
    window.addEventListener("scroll", onScrollResize, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onScrollResize);
      window.removeEventListener("scroll", onScrollResize, true);
    };
  }, [open]);

  useEffect(() => {
    const dept = departmentFromPath(pathname, departments);
    if (!dept) {
      setResponsible(null);
      return;
    }
    const div = divisionFromPath(pathname, departments);
    let pageId: string | undefined;
    if (div) {
      const norm = pathname.replace(/\/+$/, "");
      const divBase = div.basePath.replace(/\/+$/, "");
      for (const p of div.pages) {
        const full = `${divBase}${p.segment ? `/${p.segment}` : ""}`;
        if (norm === full) {
          pageId = p.id;
          break;
        }
      }
    }
    let cancelled = false;
    resolveAgentForPage({ departmentId: dept.id, divisionId: div?.id, pageId })
      .then((r) => {
        if (cancelled) return;
        const agent = agents.find((a) => a.id === r.agentId) ?? null;
        setResponsible(agent ? { agent, inheritedFrom: r.inheritedFrom } : null);
      })
      .catch(() => {
        if (!cancelled) setResponsible(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, departments, agents]);

  const currentAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId) ?? null,
    [agents, activeAgentId]
  );

  const currentConversation = useMemo(() => {
    if (chatTarget.kind !== "conversation") return null;
    return dmConversations.find((c) => c.id === chatTarget.conversationId) ?? null;
  }, [chatTarget, dmConversations]);

  const triggerLabel = useMemo(() => {
    if (chatTarget.kind === "conversation") {
      return currentConversation?.displayTitle ?? "Conversation";
    }
    return currentAgent?.name ?? activeAgentId;
  }, [chatTarget, currentConversation, currentAgent, activeAgentId]);

  const q = query.trim().toLowerCase();

  const filteredAgents = useMemo(() => {
    const eligible = agents.filter(isChatTargetAgent);
    const list = q
      ? eligible.filter(
          (a) =>
            a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)
        )
      : eligible;
    return [...list].sort((a, b) => {
      const aa = activeIds.has(a.id) ? 0 : 1;
      const bb = activeIds.has(b.id) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      if (a.id === "intelligence") return -1;
      if (b.id === "intelligence") return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agents, q, activeIds]);

  const filteredContacts = useMemo(() => {
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [contacts, q]);

  const filteredConversations = useMemo(() => {
    if (!q) return dmConversations;
    return dmConversations.filter((c) =>
      c.displayTitle.toLowerCase().includes(q)
    );
  }, [dmConversations, q]);

  const selectAgent = (id: string) => {
    setChatTarget({ kind: "agent", agentId: id });
    setOpen(false);
    setQuery("");
  };

  const selectContact = async (contact: DmContact) => {
    try {
      const res = await createDmConversation({
        kind: "direct",
        memberUserIds: [contact.id],
      });
      setChatTarget({ kind: "conversation", conversationId: res.conversation.id });
      void refreshDmConversations();
      setOpen(false);
      setQuery("");
    } catch {
      /* ignore */
    }
  };

  const selectConversation = (id: string) => {
    setChatTarget({ kind: "conversation", conversationId: id });
    setOpen(false);
    setQuery("");
  };

  const resetGroupDraft = () => {
    setGroupTitle("");
    setGroupAgentIds(new Set());
    setGroupContactIds(new Set());
  };

  const openGroupDialog = () => {
    resetGroupDraft();
    setGroupOpen(true);
    setOpen(false);
  };

  const groupMemberCount = groupContactIds.size + groupAgentIds.size;

  const createGroup = async () => {
    const tenantId = getActiveTenantId() ?? undefined;
    const memberUserIds = Array.from(groupContactIds);
    const memberAgents = Array.from(groupAgentIds).map((agentId) => ({
      agentId,
      agentTenantId: tenantId,
    }));
    if (memberUserIds.length + memberAgents.length < 1) {
      toast.error("Pick at least one other member for the group.");
      return;
    }
    setGroupBusy(true);
    try {
      const res = await createDmConversation({
        kind: "group",
        title: groupTitle.trim() || undefined,
        memberUserIds,
        memberAgents,
      });
      setChatTarget({
        kind: "conversation",
        conversationId: res.conversation.id,
      });
      void refreshDmConversations();
      setGroupOpen(false);
      setOpen(false);
      resetGroupDraft();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create group"
      );
    } finally {
      setGroupBusy(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title="Switch who you're chatting with"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md hover:bg-muted",
          titleMode
            ? "max-w-[200px] px-1 py-0.5 text-sm font-medium text-foreground"
            : "max-w-[180px] px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        )}
      >
        {!titleMode &&
          (chatTarget.kind === "conversation" ? (
            <MessageCircleIcon className="size-3.5 shrink-0" />
          ) : (
            <BotIcon className="size-3.5 shrink-0" />
          ))}
        <span
          className={cn(
            "truncate",
            titleMode ? "" : "font-medium text-foreground"
          )}
        >
          {triggerLabel}
        </span>
        {chatTarget.kind === "agent" && activeIds.has(activeAgentId) && (
          <span className="relative flex size-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/70" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
        )}
        <ChevronDownIcon className="size-3 shrink-0" />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: rect.bottom + 4,
              left: rect.left,
              width: 288,
            }}
            className="z-[60] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
          >
            {responsible &&
              chatTarget.kind === "agent" &&
              responsible.agent.id !== activeAgentId && (
                <button
                  type="button"
                  onClick={() => selectAgent(responsible.agent.id)}
                  className="flex w-full items-center gap-1.5 border-b bg-muted/40 px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-muted-foreground">
                    This page:{" "}
                    <span className="font-medium text-foreground">
                      {responsible.agent.name}
                    </span>
                  </span>
                </button>
              )}
            <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Agents, contacts, chats…"
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              onClick={openGroupDialog}
              className="flex w-full items-center gap-1.5 border-b px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <UsersIcon className="size-3.5 shrink-0" />
              New group…
            </button>
            <div className="max-h-72 overflow-y-auto p-1">
              {filteredAgents.length > 0 && (
                <p className="px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  Agents
                </p>
              )}
              {filteredAgents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => selectAgent(a.id)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs",
                    chatTarget.kind === "agent" && a.id === activeAgentId
                      ? "bg-primary/10 text-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{a.name}</span>
                </button>
              ))}

              {filteredContacts.length > 0 && (
                <p className="mt-1 px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  Contacts
                </p>
              )}
              {filteredContacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void selectContact(c)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted"
                >
                  <UserIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{c.displayName}</span>
                  <span
                    className={cn(
                      "ml-auto size-1.5 shrink-0 rounded-full",
                      c.online ? "bg-emerald-500" : "bg-muted-foreground/40"
                    )}
                  />
                </button>
              ))}

              {filteredConversations.length > 0 && (
                <p className="mt-1 px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  Conversations
                </p>
              )}
              {filteredConversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectConversation(c.id)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs",
                    chatTarget.kind === "conversation" &&
                      c.id === chatTarget.conversationId
                      ? "bg-primary/10"
                      : "hover:bg-muted"
                  )}
                >
                  <MessageCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{c.displayTitle}</span>
                  {c.unreadCount > 0 ? (
                    <span className="ml-auto rounded-full bg-primary px-1 text-[9px] text-primary-foreground">
                      {c.unreadCount}
                    </span>
                  ) : null}
                </button>
              ))}

              {filteredAgents.length === 0 &&
                filteredContacts.length === 0 &&
                filteredConversations.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No matches.
                  </div>
                )}
            </div>
          </div>,
          document.body
        )}

      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Group name (optional)</Label>
              <Input
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="e.g. Trading crew"
                className="mt-1 h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Agents</Label>
              <div className="mt-1 max-h-32 overflow-y-auto rounded-md border p-2 space-y-1">
                {agents
                  .filter((a) => isChatTargetAgent(a) && !a.isTemplate)
                  .map((a) => (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 text-xs cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={groupAgentIds.has(a.id)}
                        onChange={(e) => {
                          setGroupAgentIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(a.id);
                            else next.delete(a.id);
                            return next;
                          });
                        }}
                      />
                      {a.name}
                    </label>
                  ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Contacts</Label>
              <div className="mt-1 max-h-32 overflow-y-auto rounded-md border p-2 space-y-1">
                {contacts.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 text-xs cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={groupContactIds.has(c.id)}
                      onChange={(e) => {
                        setGroupContactIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                          return next;
                        });
                      }}
                    />
                    {c.displayName}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => void createGroup()}
              disabled={groupBusy || groupMemberCount < 1}
            >
              {groupBusy ? "Creating…" : "Create group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
