import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const mem = new Database(":memory:");

vi.mock("../../core-db.js", () => ({
  getCloudDb: () => mem,
}));

vi.mock("../../config.js", () => ({
  config: {
    web: { publicUrl: "https://app.example.com" },
    isSaas: true,
  },
}));

const {
  approveSellerLinkDevice,
  denySellerLinkDevice,
  ensureSellerLinkSchema,
  pollSellerLinkDevice,
  resolveSellerLinkBearer,
  revokeSellerLinkBearer,
  startSellerLinkDevice,
} = await import("../seller-link.js");

function seedUser(email = "seller@example.com"): string {
  const id = randomUUID();
  mem
    .prepare(
      `INSERT INTO users (id, email, display_name, is_admin)
       VALUES (?, ?, ?, 0)`
    )
    .run(id, email, "Seller");
  return id;
}

describe("seller-link device flow", () => {
  beforeEach(() => {
    mem.exec(`
      DROP TABLE IF EXISTS seller_link_tokens;
      DROP TABLE IF EXISTS seller_link_devices;
      DROP TABLE IF EXISTS users;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT,
        access_disabled INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        email_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureSellerLinkSchema(mem as never);
  });

  it("starts, approves, polls token, resolves entitlement bearer, revokes", () => {
    const userId = seedUser();
    const started = startSellerLinkDevice();
    expect(started.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(started.verificationUrl).toContain("seller_link=");

    expect(pollSellerLinkDevice(started.deviceCode)).toEqual({ status: "pending" });

    approveSellerLinkDevice(userId, started.userCode);
    const complete = pollSellerLinkDevice(started.deviceCode);
    expect(complete.status).toBe("complete");
    if (complete.status !== "complete") throw new Error("expected complete");
    expect(complete.accessToken.startsWith("gsl_")).toBe(true);

    const auth = resolveSellerLinkBearer(`Bearer ${complete.accessToken}`);
    expect(auth?.id).toBe(userId);
    expect(auth?.email).toBe("seller@example.com");

    expect(revokeSellerLinkBearer(`Bearer ${complete.accessToken}`)).toBe(true);
    expect(resolveSellerLinkBearer(`Bearer ${complete.accessToken}`)).toBeNull();
  });

  it("denies pending device", () => {
    const userId = seedUser("deny@example.com");
    const started = startSellerLinkDevice();
    denySellerLinkDevice(userId, started.userCode);
    expect(pollSellerLinkDevice(started.deviceCode)).toEqual({ status: "denied" });
  });
});
