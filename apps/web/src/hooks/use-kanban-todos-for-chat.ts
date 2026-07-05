import { useCallback, useEffect, useState } from "react";
import { fetchAiProjects, fetchCardSubtasks, getActiveTenantId, type AiProjectCard } from "@/api";
import type { KanbanTodoCard } from "@/components/intelligence/chat-parts";

function toKanbanRows(cards: AiProjectCard[]): KanbanTodoCard[] {
  return cards.map((c) => ({
    title: c.title,
    column_id: c.column_id,
    status: c.status,
  }));
}

/** Live Kanban rows for cards linked to the active chat (drives todo pill sync). */
export function useKanbanTodosForChat(
  agentId: string,
  chatId: string | null,
  enabled: boolean
): KanbanTodoCard[] {
  const [cards, setCards] = useState<KanbanTodoCard[]>([]);

  const load = useCallback(async () => {
    if (!enabled || !agentId || !chatId) {
      setCards([]);
      return;
    }
    try {
      const { cards: all } = await fetchAiProjects(agentId);
      const linked = all.filter((c) => c.linked_chat_id === chatId);
      const parents = linked.filter((c) => !c.parent_card_id);
      await Promise.all(
        parents.map((p) => fetchCardSubtasks(p.id).catch(() => undefined))
      );
      const { cards: refreshed } = await fetchAiProjects(agentId);
      const linkedAfter = refreshed.filter((c) => c.linked_chat_id === chatId);
      setCards(toKanbanRows(linkedAfter));
    } catch {
      setCards([]);
    }
  }, [agentId, chatId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled || !chatId) return;
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [enabled, chatId, load]);

  useEffect(() => {
    if (!enabled || !chatId) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const tenantId = getActiveTenantId();
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    let sock: WebSocket | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    try {
      sock = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
    } catch {
      return;
    }
    sock.onopen = () => {
      if (tenantId) {
        sock?.send(
          JSON.stringify({ type: "join_room", room: `tenant:${tenantId}` })
        );
      }
    };
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type?: string };
        if (msg.type === "card_activity") {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => void load(), 400);
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      if (debounce) clearTimeout(debounce);
      try {
        if (sock && sock.readyState <= 1) sock.close();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, chatId, load]);

  return cards;
}
