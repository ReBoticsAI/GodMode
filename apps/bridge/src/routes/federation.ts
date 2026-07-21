import { Router, type Request, type Response, type NextFunction } from "express";
import { getCoreDb, type CoreDatabase } from "../core-db.js";
import { getPluginHost } from "@godmode/plugin-host";
import {
  attachAuthContext,
  requireAuth,
} from "../services/auth/middleware.js";
import {
  executeCollectionAction,
  KernelError,
} from "../kernel/record-api.js";

function ipcEnqueue(line: string, chartbookKey?: string): string {
  return getPluginHost().enqueueIpcLine!("chart-ipc", line, chartbookKey);
}

interface FederationGrant {
  id: string;
  owner_tenant_id: string;
  resource_kind: string;
  resource_id: string;
  grantee_user_id: string | null;
  grantee_tenant_id: string | null;
  role: string;
  expires_at: string | null;
}

export class FederationAuthorizationError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function federationGrantForToken(
  core: CoreDatabase,
  token: string
): FederationGrant {
  const grant = core
    .prepare(
      `SELECT id, owner_tenant_id, resource_kind, resource_id,
              grantee_user_id, grantee_tenant_id, role, expires_at
       FROM share_grants
       WHERE federation_token=?
       LIMIT 1`
    )
    .get(token) as FederationGrant | undefined;
  if (!grant) {
    throw new FederationAuthorizationError(403, "Invalid federation token");
  }
  const expiresAt = grant.expires_at ? Date.parse(grant.expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new FederationAuthorizationError(403, "Federation token expired");
  }
  return grant;
}

export function authorizeFederationScCommand(
  core: CoreDatabase,
  token: string,
  binding: {
    verb: string;
    resourceKind: string;
    resourceId: string;
    ownerTenantId: string;
    targetTenantId: string;
  }
): FederationGrant {
  const grant = federationGrantForToken(core, token);
  if (binding.verb !== "execute") {
    throw new FederationAuthorizationError(403, "Federation verb not permitted");
  }
  if (
    !["department", "division"].includes(grant.resource_kind) ||
    !["editor", "owner"].includes(grant.role)
  ) {
    throw new FederationAuthorizationError(403, "Federation capability not permitted");
  }
  if (
    grant.resource_kind !== binding.resourceKind ||
    grant.resource_id !== binding.resourceId ||
    grant.owner_tenant_id !== binding.ownerTenantId
  ) {
    throw new FederationAuthorizationError(403, "Federation token resource mismatch");
  }
  if (grant.grantee_tenant_id !== binding.targetTenantId) {
    throw new FederationAuthorizationError(403, "Federation target tenant mismatch");
  }
  return grant;
}

const SC_COMMANDS = new Set([
  "ADD", "REMOVE", "WIRE", "ENABLE", "FLATTEN", "RECALC", "PING",
  "SET_DOM_LEVELS", "STATE", "DISCOVER", "WIRETAP", "BACKTEST_SIM",
  "BACKTEST_RESET_STATS", "BACKTEST_TEARDOWN", "REPLAY_START",
  "REPLAY_STOP", "REPLAY_STOP_ALL", "REPLAY_PAUSE", "LIST_CHARTS",
  "REPLAY_SET_SPEED", "BACKTEST_AUTO_REPLAY", "SET_TRADE_SIMULATION_MODE",
  "SET_CHART_TRADE_MODE", "SET_AUTO_TRADING_ENABLED",
  "SET_CHART_TRADE_ACCOUNT", "SET_CHART_DAYS_TO_LOAD",
  "SET_CHART_UPDATE_INTERVAL", "SET_CHART_SYMBOL", "GET_TRADE_LIST",
  "SET_STUDY_INPUT", "STUDY_INPUTS_DUMP", "REMOVE_ALL", "LIST_STUDIES",
]);

export function validateScCommandLine(line: unknown): string {
  if (typeof line !== "string") {
    throw new FederationAuthorizationError(400, "SC command line required");
  }
  const normalized = line.trim();
  if (
    !normalized ||
    normalized.length > 4096 ||
    /[\r\n\0]/.test(normalized)
  ) {
    throw new FederationAuthorizationError(400, "Malformed SC command");
  }
  const command = normalized.split("|", 1)[0]!;
  if (!SC_COMMANDS.has(command)) {
    throw new FederationAuthorizationError(400, "SC command not permitted");
  }
  return normalized;
}

function federationAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Federation token required" });
    return;
  }
  try {
    federationGrantForToken(getCoreDb(), token);
    next();
  } catch (err) {
    if (err instanceof FederationAuthorizationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/**
 * Peer Bridge API: authenticated federation surface for remote local connectors.
 * Hardware-bound marketplace plugins execute on the user's machine; remote
 * callers use Bearer tokens minted on share grants or bridge connections.
 */
export function createFederationRouter(deps: {
  pingSc: () => Promise<{ ok: boolean; detail?: string }>;
}): Router {
  const router = Router();

  router.get("/invites/:token", attachAuthContext, requireAuth, (req, res) => {
    const core = getCoreDb();
    const invite = core
      .prepare(
        `SELECT id, resource_kind, resource_id, role, invitee_email, owner_user_id, status, expires_at
         FROM federated_share_invites WHERE invite_token=?`
      )
      .get(String(req.params.token)) as Record<string, unknown> | undefined;
    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    const callerEmail = req.user?.email?.trim().toLowerCase() ?? "";
    const inviteeEmail = String(invite.invitee_email ?? "").trim().toLowerCase();
    const isInvitee = callerEmail.length > 0 && callerEmail === inviteeEmail;
    const isOwner = req.user?.id === invite.owner_user_id;
    const payload = { ...invite };
    if (!isInvitee && !isOwner) {
      delete payload.invitee_email;
    }
    res.json({ invite: payload });
  });

  router.post("/invites/:token/accept", attachAuthContext, requireAuth, async (req, res) => {
    const token = String(req.params.token);
    const { granteeTenantId } = req.body ?? {};
    if (!granteeTenantId) {
      res.status(400).json({ error: "granteeTenantId required" });
      return;
    }
    try {
      const result = await executeCollectionAction(
        getCoreDb(),
        "FederatedShareInvite",
        "accept",
        {
          invite_token: token,
          grantee_tenant_id: String(granteeTenantId),
        },
        {
          tenantId: String(granteeTenantId),
          userId: req.user!.id,
          isAdmin: req.user!.isAdmin,
          role: req.tenantRole ?? "viewer",
          source: "http",
        }
      );
      res.json(result);
    } catch (err) {
      if (err instanceof KernelError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.use(federationAuth);

  router.get("/health", async (_req, res) => {
    const sc = await deps.pingSc();
    res.json({ ok: true, sc });
  });

  router.post("/sc/:verb", async (req, res) => {
    const body = (req.body ?? {}) as {
      line?: string;
      chartbookKey?: string;
      resourceKind?: string;
      resourceId?: string;
      ownerTenantId?: string;
      targetTenantId?: string;
    };
    const token = String(req.headers.authorization).slice(7).trim();
    try {
      for (const [name, value] of Object.entries({
        resourceKind: body.resourceKind,
        resourceId: body.resourceId,
        ownerTenantId: body.ownerTenantId,
        targetTenantId: body.targetTenantId,
      })) {
        if (typeof value !== "string" || !value.trim()) {
          throw new FederationAuthorizationError(400, `${name} required`);
        }
      }
      authorizeFederationScCommand(getCoreDb(), token, {
        verb: String(req.params.verb ?? "").toLowerCase(),
        resourceKind: body.resourceKind!,
        resourceId: body.resourceId!,
        ownerTenantId: body.ownerTenantId!,
        targetTenantId: body.targetTenantId!,
      });
      const line = validateScCommandLine(body.line);
      const file = ipcEnqueue(line, body.chartbookKey);
      res.json({ ok: true, verb: "execute", enqueued: line, file });
    } catch (err) {
      if (err instanceof FederationAuthorizationError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/market/:symbol", (req, res) => {
    res.json({
      ok: true,
      symbol: req.params.symbol,
      mode: "local_read",
      price: null,
      note: "Connector should attach live market feed for this symbol",
    });
  });

  return router;
}
