/**
 * WebSocket attach for Intelligence Chat turn streaming (#442).
 * Path: /ws/chat
 *
 * Long Cursor turns (quiet prep + waitForToolConfirmation) die on Cloudflare
 * when streamed as a single HTTP SSE POST. WS is first-class on CF; this path
 * shares prepare/run with POST /api/ai/chat via setAiChatTurnHandlers.
 */
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, type WebSocketServer } from "ws";
import { config } from "./config.js";
import { getCloudDb } from "./core-db.js";
import { authenticateWsClient } from "./ws-broker.js";
import { getOperatorTenantIdCached } from "./services/auth/middleware.js";
import {
  parseWsSessionFromUrl,
  parseWsTenantIdFromUrl,
} from "./services/ws-auth.js";
import {
  listUserTenants,
  SYSTEM_USER_ID,
} from "./services/tenant-bootstrap.js";
import type { MembershipRole } from "./core-db.js";
import { resolveSession, parseSessionCookie } from "./services/auth/session-store.js";
import { coreUserToAuth } from "./types/express-auth.js";
import { mfaEnabled } from "./services/auth/mfa-and-tokens.js";
import { getTenantDb, pinTenantDb, unpinTenantDb } from "./tenant-registry.js";
import { assertSaasUserMayAccess } from "./services/saas-subscriptions.js";
import {
  getAiChatTurnHandlers,
  tryGetAiChatTurnHandlers,
  type AiChatAuthContext,
  type AiChatTurnBody,
} from "./services/ai-chat-turn.js";
import { resolveToolConfirmation } from "./services/ai-agent.js";

type ChatClientMsg = {
  type?: string;
  requestId?: string;
  toolCallId?: string;
  approved?: boolean;
  chatId?: string;
  message?: string;
  history?: AiChatTurnBody["history"];
  platformContext?: AiChatTurnBody["platformContext"];
  images?: string[];
  agentId?: string;
  contributeMemory?: boolean;
  autoAcceptTools?: boolean;
  chatMode?: AiChatTurnBody["chatMode"];
  toolAutonomy?: AiChatTurnBody["toolAutonomy"];
};

function resolveChatAuth(
  req: IncomingMessage,
  meta: { userId?: string; tenantId?: string }
): AiChatAuthContext | { error: string; code: number } {
  const core = getCloudDb();
  const querySession = config.isProduction
    ? undefined
    : parseWsSessionFromUrl(req.url);
  const sessionId =
    parseSessionCookie(req.headers.cookie) ?? querySession?.trim() ?? undefined;

  let userId = meta.userId;
  let isAdmin = false;

  if (sessionId) {
    const resolved = resolveSession(core, sessionId);
    if (resolved) {
      const access = assertSaasUserMayAccess(resolved.user);
      if (!access.ok) {
        return { error: "Access revoked", code: 403 };
      }
      const authUser = coreUserToAuth(resolved.user, {
        mfaEnabled: mfaEnabled(core, resolved.user.id),
      });
      userId = authUser.id;
      isAdmin = authUser.isAdmin;
    }
  }

  if (!userId && config.auth.allowAnonymous) {
    userId = SYSTEM_USER_ID;
    isAdmin = false;
  }

  if (!userId) {
    return { error: "Authentication required", code: 4401 };
  }

  let tenantId = meta.tenantId;
  const tenants = listUserTenants(core, userId);
  if (!tenantId) {
    if (config.auth.allowAnonymous) {
      tenantId = getOperatorTenantIdCached();
    } else if (tenants[0]?.id) {
      tenantId = tenants[0].id;
    }
  }
  if (!tenantId) {
    return { error: "Tenant required", code: 4403 };
  }

  const membership = tenants.find((t) => t.id === tenantId);
  const tenantRole: MembershipRole =
    membership?.role ?? (config.auth.allowAnonymous ? "owner" : "viewer");

  return {
    user: { id: userId, isAdmin },
    tenantId,
    tenantRole,
    tenantDb: getTenantDb(tenantId),
  };
}

const ROLE_RANK: Record<MembershipRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

export function attachChatWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (!config.auth.allowAnonymous && config.isProduction) {
      const querySession = config.isProduction
        ? undefined
        : parseWsSessionFromUrl(req.url);
      const hasCookie = Boolean(
        req.headers.cookie?.includes("godmode_session=")
      );
      if (!querySession && !hasCookie && !req.headers.authorization) {
        ws.close(4401, "Authentication required");
        return;
      }
    }

    const tenantHeader =
      typeof req.headers["x-tenant-id"] === "string"
        ? req.headers["x-tenant-id"]
        : undefined;
    const queryTenant = parseWsTenantIdFromUrl(req.url);
    const querySession = config.isProduction
      ? undefined
      : parseWsSessionFromUrl(req.url);
    const meta = authenticateWsClient(
      ws,
      req.headers.cookie,
      tenantHeader,
      queryTenant,
      querySession
    );

    if (!meta.userId && !config.auth.allowAnonymous) {
      ws.close(4401, "Authentication required");
      return;
    }
    if (!meta.tenantId) {
      if (meta.userId) {
        ws.close(4403, "Tenant required");
        return;
      }
      if (config.auth.allowAnonymous) {
        meta.tenantId = getOperatorTenantIdCached();
      } else {
        ws.close(4401, "Authentication required");
        return;
      }
    }

    const authResult = resolveChatAuth(req, meta);
    if ("error" in authResult) {
      ws.close(authResult.code, authResult.error);
      return;
    }
    const auth = authResult;
    const pinnedTenantId = auth.tenantId;
    pinTenantDb(pinnedTenantId);

    const inflight = new Map<string, AbortController>();

    const abortAll = () => {
      for (const [id, ac] of inflight) {
        ac.abort();
        inflight.delete(id);
      }
    };

    const releasePin = () => {
      unpinTenantDb(pinnedTenantId);
    };

    ws.send(
      JSON.stringify({
        type: "connected",
        tenantId: auth.tenantId,
        authenticated: Boolean(meta.userId),
      })
    );

    ws.on("message", (raw) => {
      void (async () => {
        let msg: ChatClientMsg;
        try {
          msg = JSON.parse(String(raw)) as ChatClientMsg;
        } catch {
          return;
        }

        if (msg.type === "chat_abort") {
          const requestId = String(msg.requestId ?? "").trim();
          if (!requestId) return;
          const ac = inflight.get(requestId);
          if (ac) {
            ac.abort();
            inflight.delete(requestId);
          }
          return;
        }

        if (msg.type === "confirm_tool") {
          const toolCallId = String(msg.toolCallId ?? "").trim();
          if (!toolCallId) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "toolCallId required",
              })
            );
            return;
          }
          const ok = resolveToolConfirmation(toolCallId, msg.approved === true);
          ws.send(
            JSON.stringify({
              type: "confirm_tool_result",
              toolCallId,
              ok,
            })
          );
          return;
        }

        if (msg.type !== "chat_turn") return;

        // Refresh live DB handle each turn (WS auth must not hold a closed snapshot).
        const turnAuth: AiChatAuthContext = {
          ...auth,
          tenantDb: getTenantDb(auth.tenantId),
        };

        if (ROLE_RANK[turnAuth.tenantRole as MembershipRole] < ROLE_RANK.editor) {
          ws.send(
            JSON.stringify({
              type: "ai_chat_event",
              requestId: String(msg.requestId ?? "").trim() || "unknown",
              event: "error",
              data: { error: "editor access required" },
            })
          );
          return;
        }

        const requestId = String(msg.requestId ?? "").trim() || randomUUID();
        if (inflight.has(requestId)) {
          ws.send(
            JSON.stringify({
              type: "error",
              requestId,
              error: "requestId already in flight",
            })
          );
          return;
        }

        if (!tryGetAiChatTurnHandlers()) {
          ws.send(
            JSON.stringify({
              type: "ai_chat_event",
              requestId,
              event: "error",
              data: { error: "Chat turn handlers not ready" },
            })
          );
          return;
        }

        const handlers = getAiChatTurnHandlers();
        const body: AiChatTurnBody = {
          chatId: msg.chatId,
          message: String(msg.message ?? ""),
          history: msg.history,
          platformContext: msg.platformContext,
          images: msg.images,
          agentId: msg.agentId,
          contributeMemory: msg.contributeMemory,
          autoAcceptTools: msg.autoAcceptTools,
          chatMode: msg.chatMode,
          toolAutonomy: msg.toolAutonomy,
        };

        const preparedResult = await handlers.prepare(turnAuth, body);
        if (!preparedResult.ok) {
          ws.send(
            JSON.stringify({
              type: "ai_chat_event",
              requestId,
              event: "error",
              data: preparedResult.body,
            })
          );
          return;
        }

        const abortController = new AbortController();
        inflight.set(requestId, abortController);

        const transport = {
          send: (event: string, data: unknown) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(
              JSON.stringify({
                type: "ai_chat_event",
                requestId,
                event,
                data,
              })
            );
          },
          sendPing: () => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(
              JSON.stringify({
                type: "ai_chat_ping",
                requestId,
                at: Date.now(),
              })
            );
          },
          abortSignal: abortController.signal,
          isClosed: () => ws.readyState !== WebSocket.OPEN,
        };

        try {
          await handlers.run(preparedResult.prepared, transport);
        } catch (err) {
          if (!abortController.signal.aborted && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "ai_chat_event",
                requestId,
                event: "error",
                data: {
                  error: err instanceof Error ? err.message : String(err),
                  ...((err as { code?: string })?.code
                    ? { code: String((err as { code: string }).code) }
                    : {}),
                },
              })
            );
          }
        } finally {
          inflight.delete(requestId);
        }
      })();
    });

    ws.on("close", () => {
      abortAll();
      releasePin();
    });
    ws.on("error", () => {
      /* close handler also runs; unpin is idempotent via refcount on close only once */
    });
  });
}
