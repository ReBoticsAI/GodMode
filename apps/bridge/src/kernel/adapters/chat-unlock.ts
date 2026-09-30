import type {
  ActionDef,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import type { AppDatabase } from "../../db.js";
import type {
  OperationContext,
  RecordAdapter,
} from "../adapter-registry.js";
import {
  completeUnlockTutorial,
  createUnlockSkipCheckout,
  getUnlockable,
  grantUnlockEntitlement,
  hasUnlockEntitlement,
  listUnlockableCatalog,
  listUnlockEntitlementsForUser,
  listUnlockTransactionsForUser,
  markTutorialStep,
  startUnlockTutorial,
  type UnlockEntitlementRow,
  type UnlockTransactionRow,
} from "../../services/chat-unlock.js";
import { getCloudDb } from "../../core-db.js";

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function requireUser(ctx: OperationContext): string {
  if (!ctx.userId) throw httpError(401, "Authenticated user required");
  return ctx.userId;
}

function unlockableRow(def: ObjectTypeDef, u: ReturnType<typeof getUnlockable>): RecordRow {
  if (!u) throw httpError(404, "Unlockable not found");
  return {
    id: u.id,
    objectType: def.name,
    data: {
      id: u.id,
      label: u.label,
      description: u.description,
      tutorial_id: u.tutorial_id,
      skip_price_cents: u.skip_price_cents,
      stripe_price_id: u.stripe_price_id,
      module: u.module,
      gates_json: u.gates,
    },
  };
}

function entitlementRow(def: ObjectTypeDef, row: UnlockEntitlementRow): RecordRow {
  return {
    id: row.id,
    objectType: def.name,
    data: { ...row },
  };
}

function transactionRow(def: ObjectTypeDef, row: UnlockTransactionRow): RecordRow {
  return {
    id: row.id,
    objectType: def.name,
    data: { ...row },
  };
}

export const UNLOCKABLE_ACTIONS: ActionDef[] = [
  {
    name: "start_tutorial",
    label: "Start Tutorial",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: ["viewer", "editor", "owner", "intelligence"],
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "mark_tutorial_step",
    label: "Mark Tutorial Step",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: ["viewer", "editor", "owner", "intelligence"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["step"],
      properties: { step: { type: "string" } },
    },
  },
  {
    name: "complete_tutorial",
    label: "Complete Tutorial",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: ["viewer", "editor", "owner", "intelligence"],
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "checkout_skip",
    label: "Checkout Skip Tutorial",
    target: "record",
    effect: "external",
    execution: "sync",
    roles: ["viewer", "editor", "owner", "intelligence"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["success_url", "cancel_url"],
      properties: {
        success_url: { type: "string" },
        cancel_url: { type: "string" },
        email: { type: "string" },
      },
    },
  },
];

export const unlockableAdapter: RecordAdapter = {
  id: "unlockable_service",
  list(_db, def) {
    const records = listUnlockableCatalog().map((u) => unlockableRow(def, u));
    return { objectType: def.name, records, total: records.length };
  },
  get(_db, def, id) {
    const u = getUnlockable(id);
    return u ? unlockableRow(def, u) : null;
  },
  actions: {
    start_tutorial(_db, _def, id, _input, ctx) {
      const userId = requireUser(ctx);
      return startUnlockTutorial(userId, id);
    },
    mark_tutorial_step(_db, _def, id, input, ctx) {
      const userId = requireUser(ctx);
      const step = String((input as RecordData).step ?? "");
      return markTutorialStep(userId, id, step);
    },
    complete_tutorial(_db, _def, id, _input, ctx) {
      const userId = requireUser(ctx);
      return completeUnlockTutorial(userId, id);
    },
    async checkout_skip(_db, _def, id, input, ctx) {
      const userId = requireUser(ctx);
      const data = input as RecordData;
      const successUrl = String(data.success_url ?? "");
      const cancelUrl = String(data.cancel_url ?? "");
      const email =
        String(data.email ?? "").trim() ||
        // fall back: caller should pass email; Bridge route may enrich
        "";
      if (!email) throw httpError(400, "email is required for checkout");
      return createUnlockSkipCheckout({
        userId,
        email,
        unlockableId: id,
        successUrl,
        cancelUrl,
      });
    },
  },
};

export const unlockEntitlementAdapter: RecordAdapter = {
  id: "unlock_entitlement_service",
  list(_db, def, _query, ctx) {
    const userId = requireUser(ctx);
    const rows = listUnlockEntitlementsForUser(userId);
    return {
      objectType: def.name,
      records: rows.map((r) => entitlementRow(def, r)),
      total: rows.length,
    };
  },
  get(_db, def, id, ctx) {
    const userId = requireUser(ctx);
    const row = listUnlockEntitlementsForUser(userId).find((r) => r.id === id);
    return row ? entitlementRow(def, row) : null;
  },
};

export const UNLOCK_TRANSACTION_ACTIONS: ActionDef[] = [
  {
    name: "complete",
    label: "Complete",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: ["owner", "intelligence"],
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "fail",
    label: "Fail",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: ["owner", "intelligence"],
    inputSchema: { type: "object", additionalProperties: false },
  },
];

export const unlockTransactionAdapter: RecordAdapter = {
  id: "unlock_transaction_service",
  list(_db, def, _query, ctx) {
    const userId = requireUser(ctx);
    const rows = listUnlockTransactionsForUser(userId);
    return {
      objectType: def.name,
      records: rows.map((r) => transactionRow(def, r)),
      total: rows.length,
    };
  },
  get(_db, def, id, ctx) {
    const userId = requireUser(ctx);
    const row = listUnlockTransactionsForUser(userId).find((r) => r.id === id);
    return row ? transactionRow(def, row) : null;
  },
  actions: {
    complete(_db, _def, id, _input, ctx) {
      if (ctx.source !== "system" && !ctx.systemCapability) {
        throw httpError(403, "System only");
      }
      const db = getCloudDb();
      const row = db
        .prepare(`SELECT * FROM unlock_transactions WHERE id=?`)
        .get(id) as UnlockTransactionRow | undefined;
      if (!row) throw httpError(404, "Transaction not found");
      db.prepare(
        `UPDATE unlock_transactions SET status='completed', updated_at=datetime('now') WHERE id=?`
      ).run(id);
      grantUnlockEntitlement({
        userId: row.user_id,
        unlockableId: row.unlockable_id,
        method: "purchase",
        transactionId: row.id,
        db,
      });
      return { ok: true };
    },
    fail(_db, _def, id, _input, ctx) {
      if (ctx.source !== "system" && !ctx.systemCapability) {
        throw httpError(403, "System only");
      }
      getCloudDb()
        .prepare(
          `UPDATE unlock_transactions SET status='failed', updated_at=datetime('now') WHERE id=?`
        )
        .run(id);
      return { ok: true };
    },
  },
};

export const chatUnlockAdapters = [
  unlockableAdapter,
  unlockEntitlementAdapter,
  unlockTransactionAdapter,
] as const;

/** Convenience for UI gates without full Record list. */
export function userHasChatWindowUnlock(ctx: OperationContext): boolean {
  return Boolean(ctx.userId && hasUnlockEntitlement(ctx.userId, "chat_window"));
}

export function userHasChatCreateUnlock(ctx: OperationContext): boolean {
  return Boolean(ctx.userId && hasUnlockEntitlement(ctx.userId, "chat_create"));
}

// silence unused AppDatabase import warning in some TS configs
export type _ChatUnlockDb = AppDatabase;
