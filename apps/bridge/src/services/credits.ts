import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase } from "../core-db.js";
import { assertSpendAllowed, isSpendAuthorityError } from "./authority/spend-authority.js";

export class CreditsError extends Error {
  status: number;
  /** Stable reject code when spend kill blocked a debit (#96 Slice 3). */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getWalletBalance(core: CoreDatabase, userId: string): number {
  const row = core
    .prepare("SELECT balance FROM credit_wallets WHERE user_id=?")
    .get(userId) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

export function ensureWallet(core: CoreDatabase, userId: string, initial = 0): void {
  core.prepare(
    `INSERT OR IGNORE INTO credit_wallets (user_id, balance) VALUES (?, ?)`
  ).run(userId, initial);
}

export function adjustCredits(
  core: CoreDatabase,
  opts: {
    userId: string;
    delta: number;
    reason: string;
    refType?: string;
    refId?: string;
    /** When debiting, optional tenant for per-workspace spend kill (#96 Slice 3). */
    tenantId?: string | null;
  }
): number {
  if (opts.delta < 0) {
    try {
      assertSpendAllowed({
        tenantId: opts.tenantId,
        userId: opts.userId,
        action: "adjust_credits",
      });
    } catch (err) {
      if (isSpendAuthorityError(err)) {
        throw new CreditsError(err.status, err.message, err.code);
      }
      throw err;
    }
  }
  ensureWallet(core, opts.userId);
  const tx = core.transaction(() => {
    const row = core
      .prepare("SELECT balance FROM credit_wallets WHERE user_id=?")
      .get(opts.userId) as { balance: number };
    const next = row.balance + opts.delta;
    if (next < 0) {
      throw new CreditsError(402, "Insufficient credits");
    }
    core.prepare(
      `UPDATE credit_wallets SET balance=?, updated_at=datetime('now') WHERE user_id=?`
    ).run(next, opts.userId);
    core.prepare(
      `INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      opts.userId,
      opts.delta,
      next,
      opts.reason,
      opts.refType ?? null,
      opts.refId ?? null
    );
    return next;
  });
  return tx();
}

/** Stub purchase: grant credits without payment processor. */
export function purchaseCreditsStub(
  core: CoreDatabase,
  userId: string,
  amount: number
): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CreditsError(400, "amount must be positive");
  }
  return adjustCredits(core, {
    userId,
    delta: amount,
    reason: "purchase_stub",
    refType: "purchase",
    refId: uuidv4(),
  });
}

export function listLedger(
  core: CoreDatabase,
  userId: string,
  limit = 50
): Array<Record<string, unknown>> {
  const n = Math.min(Math.max(limit, 1), 200);
  return core
    .prepare(
      `SELECT id, delta, balance_after, reason, ref_type, ref_id, created_at
       FROM credit_ledger WHERE user_id=? ORDER BY id DESC LIMIT ?`
    )
    .all(userId, n) as Array<Record<string, unknown>>;
}
