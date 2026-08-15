/**
 * Shared AI chat turn prepare/run contract for HTTP SSE and `/ws/chat`.
 * Handlers are registered from createAiRouter so both transports share one core.
 */
import type { AppDatabase } from "../db.js";
import type { OperationContext } from "../kernel/adapter-registry.js";
import type { CoreSharedChatSession, ShareGrantRole } from "../core-db.js";
import type { AiAgent } from "./agents/types.js";
import type { CodeAutonomyLevel } from "./agents/agents-db.js";
import type { IntelligenceChatMode } from "./chat-mode.js";
import type { HistoryTurn } from "./chat-history.js";
import type { PlatformContext } from "../types/platform-context.js";

export type AiChatStreamSend = (event: string, data: unknown) => void;

export type AiChatTurnTransport = {
  send: AiChatStreamSend;
  sendPing?: () => void;
  abortSignal: AbortSignal;
  /** true when the client transport is gone (for abort/cancel messaging) */
  isClosed: () => boolean;
};

export type AiChatTurnBody = {
  chatId?: string;
  message: string;
  history?: HistoryTurn[];
  platformContext?: PlatformContext;
  images?: string[];
  agentId?: string;
  contributeMemory?: boolean;
  autoAcceptTools?: boolean;
  chatMode?: IntelligenceChatMode;
  toolAutonomy?: CodeAutonomyLevel;
  /** Continue an interrupted turn without inserting another user ChatMessage. */
  resumeInterrupted?: boolean;
};

export type AiChatAuthContext = {
  user: { id: string; isAdmin: boolean };
  tenantId: string;
  tenantRole: string;
  tenantDb: AppDatabase;
};

export type AiChatAgentScope = {
  db: AppDatabase;
  tenantId: string;
  owned: boolean;
  role: ShareGrantRole;
};

export type AiChatWorkScope = {
  db: AppDatabase;
  tenantId: string;
  session: CoreSharedChatSession | null;
};

export type PreparedAiChatTurn = {
  auth: AiChatAuthContext;
  chatMode: IntelligenceChatMode;
  sessionAutonomy: CodeAutonomyLevel;
  resolvedAgentId: string;
  agent: AiAgent;
  scope: AiChatAgentScope;
  engineDb: AppDatabase;
  work: AiChatWorkScope;
  workDb: AppDatabase;
  contributeDb: AppDatabase | undefined;
  activeChatId: string;
  userMsgId: string;
  chatKernelContext: OperationContext;
  images: string[];
  history: HistoryTurn[];
  platformContext?: PlatformContext;
  message: string;
};

export type PrepareAiChatTurnResult =
  | { ok: true; prepared: PreparedAiChatTurn }
  | { ok: false; status: number; body: Record<string, unknown> };

export type AiChatTurnHandlers = {
  prepare: (
    auth: AiChatAuthContext,
    body: AiChatTurnBody
  ) => PrepareAiChatTurnResult | Promise<PrepareAiChatTurnResult>;
  run: (
    prepared: PreparedAiChatTurn,
    transport: AiChatTurnTransport
  ) => Promise<void>;
};

let handlers: AiChatTurnHandlers | null = null;

export function setAiChatTurnHandlers(h: AiChatTurnHandlers): void {
  handlers = h;
}

export function clearAiChatTurnHandlersForTests(): void {
  handlers = null;
}

export function getAiChatTurnHandlers(): AiChatTurnHandlers {
  if (!handlers) {
    throw new Error("AI chat turn handlers not registered yet");
  }
  return handlers;
}

export function tryGetAiChatTurnHandlers(): AiChatTurnHandlers | null {
  return handlers;
}
