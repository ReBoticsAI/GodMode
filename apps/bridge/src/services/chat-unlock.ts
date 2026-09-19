/**
 * Chat unlock / capability gates (legacy commerce).
 * SQLite-universe Phase 5: product retired. Chrome is open by default;
 * Stripe unlock checkout is frozen. ObjectTypes remain for historical rows.
 */
import { randomUUID } from "node:crypto";
import { getCloudDb, type CoreDatabase } from "../core-db.js";
import { resolveStripeSecretKey } from "./platform-billing.js";
import { ensureChatUnlockTables } from "./chat-unlock-schema.js";

export { ensureChatUnlockTables } from "./chat-unlock-schema.js";

/** When true, unlock commerce is frozen and gates always open. */
export const UNLOCK_PRODUCT_RETIRED = true;

export type UnlockMethod = "tutorial" | "purchase" | "admin";
export type UnlockTransactionStatus =
  | "pending"
  | "completed"
  | "failed"
  | "canceled";

export interface UnlockableDef {
  id: string;
  label: string;
  description: string;
  tutorial_id: string;
  skip_price_cents: number;
  /** Env-configured Stripe Price id; empty when not configured. */
  stripe_price_id: string;
  module: string;
  gates: string[];
}

export interface UnlockEntitlementRow {
  id: string;
  user_id: string;
  unlockable_id: string;
  method: UnlockMethod;
  granted_at: string;
  transaction_id: string | null;
}

export interface UnlockTransactionRow {
  id: string;
  user_id: string;
  unlockable_id: string;
  amount_cents: number;
  currency: string;
  provider: string;
  provider_ref: string | null;
  status: UnlockTransactionStatus;
  created_at: string;
  updated_at: string;
}

export interface UnlockTutorialProgressRow {
  id: string;
  user_id: string;
  unlockable_id: string;
  steps_json: string;
  completed_at: string | null;
  updated_at: string;
}

/** Built-in unlockable catalog (v1). */
export function listUnlockableCatalog(): UnlockableDef[] {
  const windowPrice = (process.env.STRIPE_UNLOCK_CHAT_WINDOW_PRICE_ID ?? "").trim();
  const createPrice = (process.env.STRIPE_UNLOCK_CHAT_CREATE_PRICE_ID ?? "").trim();
  return [
    {
      id: "chat_window",
      label: "Chat window controls",
      description:
        "Close (X) and resize the Intelligence chat window. Free via tutorial, or skip for $99.99.",
      tutorial_id: "chat_window",
      skip_price_cents: 9999,
      stripe_price_id: windowPrice,
      module: "platform",
      gates: ["close", "resize"],
    },
    {
      id: "chat_create",
      label: "Create new chats",
      description:
        "Create additional chat threads (+). Free via tutorial, or skip for $99,999.",
      tutorial_id: "chat_create",
      skip_price_cents: 9_999_900,
      stripe_price_id: createPrice,
      module: "platform",
      gates: ["create"],
    },
  ];
}

export function getUnlockable(id: string): UnlockableDef | undefined {
  return listUnlockableCatalog().find((u) => u.id === id);
}

export function hasUnlockEntitlement(
  userId: string,
  unlockableId: string,
  db: CoreDatabase = getCloudDb()
): boolean {
  ensureChatUnlockTables(db);
  const row = db
    .prepare(
      `SELECT id FROM unlock_entitlements WHERE user_id=? AND unlockable_id=? LIMIT 1`
    )
    .get(userId, unlockableId) as { id: string } | undefined;
  return Boolean(row);
}

export function listUnlockEntitlementsForUser(
  userId: string,
  db: CoreDatabase = getCloudDb()
): UnlockEntitlementRow[] {
  ensureChatUnlockTables(db);
  return db
    .prepare(
      `SELECT * FROM unlock_entitlements WHERE user_id=? ORDER BY granted_at DESC`
    )
    .all(userId) as UnlockEntitlementRow[];
}

export function grantUnlockEntitlement(opts: {
  userId: string;
  unlockableId: string;
  method: UnlockMethod;
  transactionId?: string | null;
  db?: CoreDatabase;
}): UnlockEntitlementRow {
  const db = opts.db ?? getCloudDb();
  ensureChatUnlockTables(db);
  if (!getUnlockable(opts.unlockableId)) {
    throw Object.assign(new Error(`Unknown unlockable: ${opts.unlockableId}`), {
      status: 400,
    });
  }
  const existing = db
    .prepare(
      `SELECT * FROM unlock_entitlements WHERE user_id=? AND unlockable_id=? LIMIT 1`
    )
    .get(opts.userId, opts.unlockableId) as UnlockEntitlementRow | undefined;
  if (existing) return existing;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO unlock_entitlements (
      id, user_id, unlockable_id, method, transaction_id
    ) VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.userId,
    opts.unlockableId,
    opts.method,
    opts.transactionId ?? null
  );
  return db
    .prepare(`SELECT * FROM unlock_entitlements WHERE id=?`)
    .get(id) as UnlockEntitlementRow;
}

/** Tutorial steps required per unlockable (server-validated). */
export const UNLOCK_TUTORIAL_STEPS: Record<string, string[]> = {
  chat_window: [
    "open_chat",
    "send_message",
    "acknowledge_graph",
    "confirm_controls",
  ],
  chat_create: [
    "open_chat",
    "open_history",
    "acknowledge_threads",
    "confirm_create",
  ],
};

export function startUnlockTutorial(
  userId: string,
  unlockableId: string,
  db: CoreDatabase = getCloudDb()
): UnlockTutorialProgressRow {
  ensureChatUnlockTables(db);
  if (!getUnlockable(unlockableId)) {
    throw Object.assign(new Error(`Unknown unlockable: ${unlockableId}`), {
      status: 400,
    });
  }
  const existing = db
    .prepare(
      `SELECT * FROM unlock_tutorial_progress WHERE user_id=? AND unlockable_id=?`
    )
    .get(userId, unlockableId) as UnlockTutorialProgressRow | undefined;
  if (existing) return existing;
  const id = randomUUID();
  const steps: Record<string, boolean> = {};
  for (const step of UNLOCK_TUTORIAL_STEPS[unlockableId] ?? []) {
    steps[step] = false;
  }
  db.prepare(
    `INSERT INTO unlock_tutorial_progress (
      id, user_id, unlockable_id, steps_json
    ) VALUES (?, ?, ?, ?)`
  ).run(id, userId, unlockableId, JSON.stringify(steps));
  return db
    .prepare(`SELECT * FROM unlock_tutorial_progress WHERE id=?`)
    .get(id) as UnlockTutorialProgressRow;
}

export function markTutorialStep(
  userId: string,
  unlockableId: string,
  step: string,
  db: CoreDatabase = getCloudDb()
): UnlockTutorialProgressRow {
  ensureChatUnlockTables(db);
  const required = UNLOCK_TUTORIAL_STEPS[unlockableId];
  if (!required?.includes(step)) {
    throw Object.assign(new Error(`Unknown tutorial step: ${step}`), {
      status: 400,
    });
  }
  let row = startUnlockTutorial(userId, unlockableId, db);
  const steps = JSON.parse(row.steps_json || "{}") as Record<string, boolean>;
  steps[step] = true;
  const allDone = required.every((s) => steps[s]);
  db.prepare(
    `UPDATE unlock_tutorial_progress
     SET steps_json=?, completed_at=CASE WHEN ? THEN datetime('now') ELSE completed_at END,
         updated_at=datetime('now')
     WHERE id=?`
  ).run(JSON.stringify(steps), allDone ? 1 : 0, row.id);
  if (allDone) {
    grantUnlockEntitlement({
      userId,
      unlockableId,
      method: "tutorial",
      db,
    });
  }
  return db
    .prepare(`SELECT * FROM unlock_tutorial_progress WHERE id=?`)
    .get(row.id) as UnlockTutorialProgressRow;
}

export function completeUnlockTutorial(
  userId: string,
  unlockableId: string,
  db: CoreDatabase = getCloudDb()
): UnlockEntitlementRow {
  ensureChatUnlockTables(db);
  const required = UNLOCK_TUTORIAL_STEPS[unlockableId];
  if (!required) {
    throw Object.assign(new Error(`Unknown unlockable: ${unlockableId}`), {
      status: 400,
    });
  }
  const row = startUnlockTutorial(userId, unlockableId, db);
  const steps = JSON.parse(row.steps_json || "{}") as Record<string, boolean>;
  if (!required.every((s) => steps[s])) {
    throw Object.assign(new Error("Tutorial steps incomplete"), { status: 400 });
  }
  db.prepare(
    `UPDATE unlock_tutorial_progress
     SET completed_at=datetime('now'), updated_at=datetime('now')
     WHERE id=?`
  ).run(row.id);
  return grantUnlockEntitlement({
    userId,
    unlockableId,
    method: "tutorial",
    db,
  });
}

export function getChatUnlockStatus(
  userId: string | undefined,
  db: CoreDatabase = getCloudDb()
): {
  unlockables: Array<
    UnlockableDef & {
      entitled: boolean;
      method: UnlockMethod | null;
      tutorialSteps: string[];
      tutorialProgress: Record<string, boolean>;
    }
  >;
  canCloseResize: boolean;
  canCreateChat: boolean;
} {
  const entitlements = userId
    ? listUnlockEntitlementsForUser(userId, db)
    : [];
  const byId = new Map(entitlements.map((e) => [e.unlockable_id, e]));
  ensureChatUnlockTables(db);

  const unlockables = listUnlockableCatalog().map((u) => {
    const ent = byId.get(u.id);
    let tutorialProgress: Record<string, boolean> = {};
    if (userId) {
      const prog = db
        .prepare(
          `SELECT steps_json FROM unlock_tutorial_progress
           WHERE user_id=? AND unlockable_id=?`
        )
        .get(userId, u.id) as { steps_json: string } | undefined;
      if (prog?.steps_json) {
        try {
          tutorialProgress = JSON.parse(prog.steps_json) as Record<
            string,
            boolean
          >;
        } catch {
          tutorialProgress = {};
        }
      }
    }
    return {
      ...u,
      // SQLite-universe: Unlock hubs removed from The Graph; chrome open by default.
      entitled: true,
      method: ent?.method ?? "admin",
      tutorialSteps: [],
      tutorialProgress,
    };
  });

  return {
    unlockables,
    canCloseResize: true,
    canCreateChat: true,
  };
}

function stripeForm(params: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) body.set(k, v);
  }
  return body;
}

export async function createUnlockSkipCheckout(opts: {
  userId: string;
  email: string;
  unlockableId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string; transactionId: string }> {
  if (UNLOCK_PRODUCT_RETIRED) {
    throw Object.assign(
      new Error(
        "Unlock commerce is retired. Chat chrome is open by default (SQLite-universe)."
      ),
      { status: 410 }
    );
  }
  const unlockable = getUnlockable(opts.unlockableId);
  if (!unlockable) {
    throw Object.assign(new Error(`Unknown unlockable: ${opts.unlockableId}`), {
      status: 400,
    });
  }
  if (hasUnlockEntitlement(opts.userId, opts.unlockableId)) {
    throw Object.assign(new Error("Already unlocked"), { status: 409 });
  }
  const secret = resolveStripeSecretKey();
  if (!secret) {
    throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
  }
  if (!unlockable.stripe_price_id) {
    throw Object.assign(
      new Error(
        `Stripe price not configured for ${opts.unlockableId} (set STRIPE_UNLOCK_*_PRICE_ID)`
      ),
      { status: 503 }
    );
  }

  const db = getCloudDb();
  ensureChatUnlockTables(db);
  const transactionId = randomUUID();
  db.prepare(
    `INSERT INTO unlock_transactions (
      id, user_id, unlockable_id, amount_cents, currency, provider, status
    ) VALUES (?, ?, ?, ?, 'usd', 'stripe', 'pending')`
  ).run(
    transactionId,
    opts.userId,
    opts.unlockableId,
    unlockable.skip_price_cents
  );

  const body = stripeForm({
    mode: "payment",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    customer_email: opts.email.trim().toLowerCase(),
    "line_items[0][price]": unlockable.stripe_price_id,
    "line_items[0][quantity]": "1",
    "metadata[godmode_unlock]": "1",
    "metadata[godmode_unlockable_id]": opts.unlockableId,
    "metadata[godmode_user_id]": opts.userId,
    "metadata[godmode_unlock_tx]": transactionId,
    "payment_intent_data[metadata][godmode_unlock]": "1",
    "payment_intent_data[metadata][godmode_unlock_tx]": transactionId,
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.id || !json.url) {
    db.prepare(
      `UPDATE unlock_transactions SET status='failed', updated_at=datetime('now') WHERE id=?`
    ).run(transactionId);
    throw Object.assign(
      new Error(json.error?.message ?? `Stripe checkout failed (${res.status})`),
      { status: 502 }
    );
  }

  db.prepare(
    `UPDATE unlock_transactions
     SET provider_ref=?, updated_at=datetime('now') WHERE id=?`
  ).run(json.id, transactionId);

  return { url: json.url, sessionId: json.id, transactionId };
}

/** Complete unlock purchase from Stripe checkout.session.completed metadata. */
export function completeUnlockCheckoutSession(obj: Record<string, unknown>): {
  completed: boolean;
} {
  const metadata = (obj.metadata ?? {}) as Record<string, string>;
  if (metadata.godmode_unlock !== "1") return { completed: false };

  const sessionId = typeof obj.id === "string" ? obj.id : "";
  const unlockableId = metadata.godmode_unlockable_id?.trim() ?? "";
  const userId = metadata.godmode_user_id?.trim() ?? "";
  const txId = metadata.godmode_unlock_tx?.trim() ?? "";
  if (!sessionId || !unlockableId || !userId) return { completed: false };

  const db = getCloudDb();
  ensureChatUnlockTables(db);

  let tx = txId
    ? (db
        .prepare(`SELECT * FROM unlock_transactions WHERE id=?`)
        .get(txId) as UnlockTransactionRow | undefined)
    : undefined;
  if (!tx) {
    tx = db
      .prepare(`SELECT * FROM unlock_transactions WHERE provider_ref=?`)
      .get(sessionId) as UnlockTransactionRow | undefined;
  }
  if (!tx) {
    const id = randomUUID();
    const unlockable = getUnlockable(unlockableId);
    db.prepare(
      `INSERT INTO unlock_transactions (
        id, user_id, unlockable_id, amount_cents, currency, provider,
        provider_ref, status
      ) VALUES (?, ?, ?, ?, 'usd', 'stripe', ?, 'completed')`
    ).run(
      id,
      userId,
      unlockableId,
      unlockable?.skip_price_cents ?? 0,
      sessionId
    );
    grantUnlockEntitlement({
      userId,
      unlockableId,
      method: "purchase",
      transactionId: id,
      db,
    });
    return { completed: true };
  }

  db.prepare(
    `UPDATE unlock_transactions
     SET status='completed', provider_ref=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(sessionId, tx.id);
  grantUnlockEntitlement({
    userId: tx.user_id,
    unlockableId: tx.unlockable_id,
    method: "purchase",
    transactionId: tx.id,
    db,
  });
  return { completed: true };
}

export function listUnlockTransactionsForUser(
  userId: string,
  db: CoreDatabase = getCloudDb()
): UnlockTransactionRow[] {
  ensureChatUnlockTables(db);
  return db
    .prepare(
      `SELECT * FROM unlock_transactions WHERE user_id=? ORDER BY created_at DESC`
    )
    .all(userId) as UnlockTransactionRow[];
}

export type ChatGraphDoc = {
  nodes: Array<{
    id: string;
    chatId: string;
    label: string;
    position: { x: number; y: number };
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
};

export function getChatGraphDoc(
  userId: string,
  db: CoreDatabase = getCloudDb()
): ChatGraphDoc {
  ensureChatUnlockTables(db);
  const row = db
    .prepare(`SELECT doc_json FROM chat_graph_docs WHERE user_id=?`)
    .get(userId) as { doc_json: string } | undefined;
  if (!row?.doc_json) return { nodes: [], edges: [] };
  try {
    const parsed = JSON.parse(row.doc_json) as ChatGraphDoc;
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

export function saveChatGraphDoc(
  userId: string,
  doc: ChatGraphDoc,
  tenantId?: string | null,
  db: CoreDatabase = getCloudDb()
): ChatGraphDoc {
  ensureChatUnlockTables(db);
  const json = JSON.stringify({
    nodes: doc.nodes ?? [],
    edges: doc.edges ?? [],
  });
  const existing = db
    .prepare(`SELECT id FROM chat_graph_docs WHERE user_id=?`)
    .get(userId) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE chat_graph_docs SET doc_json=?, tenant_id=COALESCE(?, tenant_id),
       updated_at=datetime('now') WHERE id=?`
    ).run(json, tenantId ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO chat_graph_docs (id, user_id, tenant_id, doc_json)
       VALUES (?, ?, ?, ?)`
    ).run(randomUUID(), userId, tenantId ?? null, json);
  }
  return getChatGraphDoc(userId, db);
}

export function dockChatOntoGraph(opts: {
  userId: string;
  chatId: string;
  label: string;
  tenantId?: string | null;
}): ChatGraphDoc {
  const doc = getChatGraphDoc(opts.userId);
  if (doc.nodes.some((n) => n.chatId === opts.chatId)) {
    return doc;
  }
  const id = `chat:${opts.chatId}`;
  const index = doc.nodes.length;
  doc.nodes.push({
    id,
    chatId: opts.chatId,
    label: opts.label || "Chat",
    position: { x: 120 + (index % 4) * 220, y: 100 + Math.floor(index / 4) * 140 },
  });
  return saveChatGraphDoc(opts.userId, doc, opts.tenantId);
}

/** Soft-check config surface for ops. Retired product always reports false. */
export function unlockStripeConfigured(): boolean {
  if (UNLOCK_PRODUCT_RETIRED) return false;
  return Boolean(
    resolveStripeSecretKey() &&
      ((process.env.STRIPE_UNLOCK_CHAT_WINDOW_PRICE_ID ?? "").trim() ||
        (process.env.STRIPE_UNLOCK_CHAT_CREATE_PRICE_ID ?? "").trim())
  );
}

/**
 * Admin / local-preview grant (skip tutorial without Stripe).
 * Prefers method `admin`; falls back to `tutorial` on older DBs whose CHECK
 * constraint does not yet allow `admin`.
 */
export function adminGrantUnlockables(opts: {
  userId: string;
  unlockableIds: string[];
  db?: CoreDatabase;
}): UnlockEntitlementRow[] {
  const db = opts.db ?? getCloudDb();
  ensureChatUnlockTables(db);
  const out: UnlockEntitlementRow[] = [];
  for (const unlockableId of opts.unlockableIds) {
    if (!getUnlockable(unlockableId)) {
      throw Object.assign(new Error(`Unknown unlockable: ${unlockableId}`), {
        status: 400,
      });
    }
    try {
      out.push(
        grantUnlockEntitlement({
          userId: opts.userId,
          unlockableId,
          method: "admin",
          db,
        })
      );
    } catch {
      out.push(
        grantUnlockEntitlement({
          userId: opts.userId,
          unlockableId,
          method: "tutorial",
          db,
        })
      );
    }
  }
  return out;
}
