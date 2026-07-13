import type { EventEmitter } from "node:events";
import cron, { type ScheduledTask } from "node-cron";
import type { AppDatabase } from "../db.js";
import type { AiQueueWorker } from "./ai-queue-worker.js";

const DISTILL_DEBOUNCE_MS = 45_000;

interface PendingDistill {
  chatId: string;
  agentId: string;
  tenantId: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Debounced episodic distill on chat_completed + nightly wiki synthesize cron.
 * Jobs run through AiQueueWorker so the main LLM stays serialized.
 */
export class MemoryMaintenanceService {
  private pending = new Map<string, PendingDistill>();
  private cronTask: ScheduledTask | null = null;
  private started = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly bus: EventEmitter,
    private readonly queue: AiQueueWorker
  ) {
    this.bus.on("chat_completed", (payload: unknown) => {
      const p = payload as {
        chatId?: string;
        agentId?: string;
        workTenantId?: string;
      };
      if (!p?.chatId || !p.agentId) return;
      this.scheduleDistill({
        chatId: p.chatId,
        agentId: p.agentId,
        tenantId: p.workTenantId ?? "",
      });
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // Daily idle window: propose wiki consolidations (operator-local timezone ok).
    if (cron.validate("0 4 * * *")) {
      this.cronTask = cron.schedule("0 4 * * *", () => {
        this.enqueueWikiSynthesize("");
      });
    }
  }

  stop(): void {
    this.started = false;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.cronTask?.stop();
    this.cronTask = null;
  }

  /** Immediate enqueue (compaction path / manual). */
  enqueueDistill(input: {
    chatId: string;
    agentId: string;
    tenantId?: string;
    force?: boolean;
  }): string {
    return this.queue.enqueue({
      context: {
        episodicDistillChatId: input.chatId,
        episodicDistillAgentId: input.agentId,
        episodicDistillForce: Boolean(input.force),
      },
      priority: 0,
      tenantId: input.tenantId || undefined,
    });
  }

  enqueueWikiSynthesize(tenantId: string, agentId = "intelligence"): string {
    return this.queue.enqueue({
      context: {
        wikiSynthesize: true,
        wikiSynthesizeAgentId: agentId,
      },
      priority: 0,
      tenantId: tenantId || undefined,
    });
  }

  private scheduleDistill(input: {
    chatId: string;
    agentId: string;
    tenantId: string;
  }): void {
    const key = `${input.tenantId}:${input.chatId}`;
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.enqueueDistill(input);
    }, DISTILL_DEBOUNCE_MS);
    this.pending.set(key, { ...input, timer });
  }
}
