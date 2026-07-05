import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BotIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIntelligence } from "@/lib/intelligence-context";
import { useStructure } from "@/lib/structure-context";
import { departmentFromPath, divisionFromPath } from "@/lib/navigation";
import {
  fetchAiAgents,
  fetchActiveAgents,
  resolveAgentForPage,
  type AiAgent,
} from "@/api";

/**
 * Header "Agent Search" combobox. Selecting an agent possesses it (sets the
 * global activeAgentId), which scopes the Tasks/Workflows tabs and syncs the
 * Builder tree. Active agents (running work) are pinned to the top.
 */
export function AgentSearch() {
  const { activeAgentId, setActiveAgentId, pathname } = useIntelligence();
  const { departments } = useStructure();
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [responsible, setResponsible] = useState<{
    agent: AiAgent;
    inheritedFrom: string;
  } | null>(null);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchAiAgents()
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
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

  // Refresh the agent list whenever the menu opens so freshly cloned/deleted
  // subagents show up without a panel remount.
  useEffect(() => {
    if (!open) return;
    fetchAiAgents()
      .then((r) => setAgents(r.agents))
      .catch(() => undefined);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

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

  // Surface (but do not auto-possess) the agent responsible for the current
  // page via the department/division/page inheritance chain.
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

  const current = useMemo(
    () => agents.find((a) => a.id === activeAgentId) ?? null,
    [agents, activeAgentId]
  );

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? agents.filter(
          (a) =>
            a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)
        )
      : agents;
    return [...filtered].sort((a, b) => {
      const aa = activeIds.has(a.id) ? 0 : 1;
      const bb = activeIds.has(b.id) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      if (a.id === "intelligence") return -1;
      if (b.id === "intelligence") return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agents, query, activeIds]);

  const select = (id: string) => {
    setActiveAgentId(id);
    setOpen(false);
    setQuery("");
  };

  const triggerName = current?.name ?? activeAgentId;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title="Possess agent"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-[160px] items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <BotIcon className="size-3.5 shrink-0" />
        <span className="truncate font-medium text-foreground">{triggerName}</span>
        {activeIds.has(activeAgentId) && (
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
              width: 256,
            }}
            className="z-[60] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
          >
            {responsible && responsible.agent.id !== activeAgentId && (
              <button
                type="button"
                onClick={() => select(responsible.agent.id)}
                className="flex w-full items-center gap-1.5 border-b bg-muted/40 px-2 py-1.5 text-left text-xs hover:bg-muted"
                title="Possess the agent responsible for this page"
              >
                <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">
                  This page:{" "}
                  <span className="font-medium text-foreground">
                    {responsible.agent.name}
                  </span>
                </span>
                <span className="ml-auto shrink-0 rounded bg-background px-1 text-[8px] uppercase tracking-wide text-muted-foreground">
                  possess
                </span>
              </button>
            )}
            <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents…"
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {sorted.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No agents found.
                </div>
              )}
              {sorted.map((a) => {
                const active = activeIds.has(a.id);
                const possessed = a.id === activeAgentId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => select(a.id)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs",
                      possessed ? "bg-primary/10 text-foreground" : "hover:bg-muted"
                    )}
                  >
                    <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{a.name}</span>
                    {active && (
                      <span
                        className="relative ml-auto flex size-1.5 shrink-0"
                        title="Currently performing tasks"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/70" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
