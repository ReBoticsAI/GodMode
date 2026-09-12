/**
 * SQLite-universe registry: path index + open-set path jail (Phase 2).
 * Spec: docs/SQLITE_UNIVERSE.md
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

export const SQLITE_UNIVERSE_MAX_OPEN = 8;

const ALLOWED_PREFIXES = [
  "actors/",
  "vaults/",
  "chats/",
  "surfaces/",
  "heart/",
  "registry.sqlite",
] as const;

let registryDb: Database.Database | null = null;

export function sqliteUniverseRoot(): string {
  const root = path.join(config.dataDir, "sqlite-universe");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function registryPath(): string {
  return path.join(sqliteUniverseRoot(), "registry.sqlite");
}

export function getRegistryDb(): Database.Database {
  if (registryDb) return registryDb;
  const p = registryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  registryDb = new Database(p);
  registryDb.pragma("journal_mode = WAL");
  registryDb.exec(`
    CREATE TABLE IF NOT EXISTS universe_entries (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      owner_kind TEXT,
      owner_id TEXT,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_universe_owner
      ON universe_entries(owner_kind, owner_id);
    CREATE INDEX IF NOT EXISTS idx_universe_path
      ON universe_entries(relative_path);
  `);
  // Older pilots had UNIQUE(relative_path); vault slots share a vault file path.
  migrateUniverseEntriesDropPathUnique(registryDb);
  // Hub (Bridge) ops/logs SoR; on-disk path stays heart/ until a dual-read migration.
  upsertUniverseEntry({
    id: "heart:bridge",
    kind: "heart",
    relativePath: "heart/bridge.sqlite",
    ownerKind: "system",
    ownerId: "bridge",
    label: "Hub",
  });
  prepareOpenSet(["heart/bridge.sqlite"]);
  return registryDb;
}

function migrateUniverseEntriesDropPathUnique(db: Database.Database): void {
  const idx = db
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE type = 'table' AND name = 'universe_entries'`
    )
    .get() as { sql: string } | undefined;
  if (!idx?.sql || !/relative_path\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(idx.sql)) {
    return;
  }
  db.exec(`
    CREATE TABLE universe_entries_v2 (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      owner_kind TEXT,
      owner_id TEXT,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO universe_entries_v2
      SELECT id, kind, relative_path, owner_kind, owner_id, label, created_at, updated_at
      FROM universe_entries;
    DROP TABLE universe_entries;
    ALTER TABLE universe_entries_v2 RENAME TO universe_entries;
    CREATE INDEX IF NOT EXISTS idx_universe_owner
      ON universe_entries(owner_kind, owner_id);
    CREATE INDEX IF NOT EXISTS idx_universe_path
      ON universe_entries(relative_path);
  `);
}

export function closeRegistryDb(): void {
  if (registryDb) {
    try {
      registryDb.close();
    } catch {
      /* ignore */
    }
    registryDb = null;
  }
}

export type UniverseEntry = {
  id: string;
  kind: string;
  relativePath: string;
  ownerKind?: string | null;
  ownerId?: string | null;
  label?: string | null;
};

export function upsertUniverseEntry(entry: {
  id: string;
  kind: string;
  relativePath: string;
  ownerKind?: string;
  ownerId?: string;
  label?: string;
}): void {
  const db = getRegistryDb();
  db.prepare(
    `INSERT INTO universe_entries (id, kind, relative_path, owner_kind, owner_id, label, updated_at)
     VALUES (@id, @kind, @relativePath, @ownerKind, @ownerId, @label, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       relative_path = excluded.relative_path,
       owner_kind = excluded.owner_kind,
       owner_id = excluded.owner_id,
       label = excluded.label,
       updated_at = datetime('now')`
  ).run({
    id: entry.id,
    kind: entry.kind,
    relativePath: entry.relativePath.replace(/\\/g, "/"),
    ownerKind: entry.ownerKind ?? null,
    ownerId: entry.ownerId ?? null,
    label: entry.label ?? null,
  });
}

export function listUniverseEntries(opts?: {
  ownerKind?: string;
  ownerId?: string;
}): UniverseEntry[] {
  const db = getRegistryDb();
  if (opts?.ownerKind && opts?.ownerId) {
    return db
      .prepare(
        `SELECT id, kind, relative_path AS relativePath, owner_kind AS ownerKind,
                owner_id AS ownerId, label
         FROM universe_entries
         WHERE owner_kind = ? AND owner_id = ?
         ORDER BY kind, id`
      )
      .all(opts.ownerKind, opts.ownerId) as UniverseEntry[];
  }
  return db
    .prepare(
      `SELECT id, kind, relative_path AS relativePath, owner_kind AS ownerKind,
              owner_id AS ownerId, label
       FROM universe_entries
       ORDER BY kind, id`
    )
    .all() as UniverseEntry[];
}

/** Backup / tooling: registry walk with absolute paths (Phase 6 manifest). */
export function listUniverseManifest(): Array<
  UniverseEntry & { absolutePath: string; exists: boolean }
> {
  return listUniverseEntries().map((entry) => {
    const resolved = resolveUniversePath(entry.relativePath);
    if (!resolved.ok) {
      return {
        ...entry,
        absolutePath: "",
        exists: false,
      };
    }
    return {
      ...entry,
      absolutePath: resolved.absolutePath,
      exists: fs.existsSync(resolved.absolutePath),
    };
  });
}

/** Ensure You (User) actor file (Phase 3/4 pilot). */
export function ensureUserUniverseFile(opts: {
  userId: string;
  label?: string;
}): { relativePath: string; absolutePath: string } {
  const relativePath = `actors/users/${opts.userId}.sqlite`;
  const prepared = prepareOpenSet([relativePath]);
  const hit = prepared.opened[0];
  if (!hit) {
    throw new Error(prepared.rejected[0]?.error ?? "Failed to create user DB");
  }
  upsertUniverseEntry({
    id: `user:${opts.userId}`,
    kind: "user",
    relativePath,
    ownerKind: "user",
    ownerId: opts.userId,
    label: opts.label ?? opts.userId,
  });
  const abs = resolveUniversePath(relativePath);
  if (abs.ok) {
    const udb = new Database(abs.absolutePath);
    udb.exec(`
      CREATE TABLE IF NOT EXISTS child_links (
        child_kind TEXT NOT NULL,
        child_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (child_kind, child_id)
      );
    `);
    udb.close();
  }
  return { relativePath: hit.relativePath, absolutePath: hit.absolutePath };
}

/** Normalize and jail a relative path under sqlite-universe root. */
export function resolveUniversePath(relativePath: string): {
  ok: true;
  relativePath: string;
  absolutePath: string;
} | { ok: false; error: string } {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    return { ok: false, error: "Path escapes jail" };
  }
  const allowed = ALLOWED_PREFIXES.some(
    (p) => normalized === p || normalized.startsWith(p)
  );
  if (!allowed) {
    return { ok: false, error: "Path prefix not allowed" };
  }
  if (!normalized.endsWith(".sqlite") && normalized !== "registry.sqlite") {
    return { ok: false, error: "Only .sqlite paths allowed" };
  }
  const absolutePath = path.resolve(sqliteUniverseRoot(), normalized);
  const root = path.resolve(sqliteUniverseRoot());
  if (!absolutePath.startsWith(root + path.sep) && absolutePath !== root) {
    return { ok: false, error: "Path escapes data root" };
  }
  return { ok: true, relativePath: normalized, absolutePath };
}

export type OpenSetResult = {
  opened: Array<{ relativePath: string; absolutePath: string; existed: boolean }>;
  rejected: Array<{ relativePath: string; error: string }>;
};

/**
 * Validate and ensure files exist for an open-set request.
 * Does not keep long-lived handles; callers open as needed.
 */
export function prepareOpenSet(paths: string[]): OpenSetResult {
  const opened: OpenSetResult["opened"] = [];
  const rejected: OpenSetResult["rejected"] = [];
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  if (unique.length > SQLITE_UNIVERSE_MAX_OPEN) {
    return {
      opened: [],
      rejected: unique.map((relativePath) => ({
        relativePath,
        error: `Open set exceeds max ${SQLITE_UNIVERSE_MAX_OPEN}`,
      })),
    };
  }
  for (const raw of unique) {
    const resolved = resolveUniversePath(raw);
    if (!resolved.ok) {
      rejected.push({ relativePath: raw, error: resolved.error });
      continue;
    }
    fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
    const existed = fs.existsSync(resolved.absolutePath);
    if (!existed) {
      // Create empty SQLite shell so tools can open it.
      const db = new Database(resolved.absolutePath);
      db.pragma("journal_mode = WAL");
      db.close();
    }
    opened.push({
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      existed,
    });
  }
  return { opened, rejected };
}

/** Ensure a chat-thread file and registry row (Phase 3 pilot). */
export function ensureChatUniverseFile(opts: {
  chatId: string;
  ownerAgentId: string;
  label?: string;
}): { relativePath: string; absolutePath: string } {
  const relativePath = `chats/${opts.chatId}.sqlite`;
  const prepared = prepareOpenSet([relativePath]);
  const hit = prepared.opened[0];
  if (!hit) {
    throw new Error(prepared.rejected[0]?.error ?? "Failed to create chat DB");
  }
  upsertUniverseEntry({
    id: `chat:${opts.chatId}`,
    kind: "chat",
    relativePath,
    ownerKind: "agent",
    ownerId: opts.ownerAgentId,
    label: opts.label ?? opts.chatId,
  });
  // Dual-write: parent agent metadata child list.
  const agentRel = `actors/agents/${opts.ownerAgentId}.sqlite`;
  prepareOpenSet([agentRel]);
  upsertUniverseEntry({
    id: `agent:${opts.ownerAgentId}`,
    kind: "agent",
    relativePath: agentRel,
    ownerKind: "agent",
    ownerId: opts.ownerAgentId,
    label: opts.ownerAgentId,
  });
  const agentAbs = resolveUniversePath(agentRel);
  if (agentAbs.ok) {
    const adb = new Database(agentAbs.absolutePath);
    adb.exec(`
      CREATE TABLE IF NOT EXISTS child_chats (
        chat_id TEXT PRIMARY KEY,
        relative_path TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    adb.prepare(
      `INSERT INTO child_chats (chat_id, relative_path, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(chat_id) DO UPDATE SET
         relative_path = excluded.relative_path,
         updated_at = datetime('now')`
    ).run(opts.chatId, relativePath);
    adb.close();
  }
  return { relativePath: hit.relativePath, absolutePath: hit.absolutePath };
}

/** Ensure an agent actor file and registry row (Phase 3 pilot). */
export function ensureAgentUniverseFile(opts: {
  agentId: string;
  ownerUserId?: string;
  label?: string;
}): { relativePath: string; absolutePath: string } {
  const relativePath = `actors/agents/${opts.agentId}.sqlite`;
  const prepared = prepareOpenSet([relativePath]);
  const hit = prepared.opened[0];
  if (!hit) {
    throw new Error(prepared.rejected[0]?.error ?? "Failed to create agent DB");
  }
  upsertUniverseEntry({
    id: `agent:${opts.agentId}`,
    kind: "agent",
    relativePath,
    ownerKind: opts.ownerUserId ? "user" : "agent",
    ownerId: opts.ownerUserId ?? opts.agentId,
    label: opts.label ?? opts.agentId,
  });
  return { relativePath: hit.relativePath, absolutePath: hit.absolutePath };
}

/** Ensure User and Intelligence vault files (Phase 4 layout). */
export function ensureVaultUniverseFiles(opts: {
  userId: string;
  intelligenceAgentId?: string;
}): {
  userVault: { relativePath: string; absolutePath: string };
  intelligenceVault: { relativePath: string; absolutePath: string };
} {
  const intelId = opts.intelligenceAgentId ?? "intelligence";
  const userRel = `vaults/users/${opts.userId}.sqlite`;
  const intelRel = `vaults/agents/${intelId}.sqlite`;
  const prepared = prepareOpenSet([userRel, intelRel]);
  const userHit = prepared.opened.find((o) => o.relativePath === userRel);
  const intelHit = prepared.opened.find((o) => o.relativePath === intelRel);
  if (!userHit || !intelHit) {
    throw new Error(prepared.rejected[0]?.error ?? "vault ensure failed");
  }
  upsertUniverseEntry({
    id: `vault:user:${opts.userId}`,
    kind: "vault",
    relativePath: userRel,
    ownerKind: "user",
    ownerId: opts.userId,
    label: "User Vault",
  });
  upsertUniverseEntry({
    id: `vault:agent:${intelId}`,
    kind: "vault",
    relativePath: intelRel,
    ownerKind: "agent",
    ownerId: intelId,
    label: "Intelligence Vault",
  });
  // Bank children under vaults (registry only; content still legacy until full migrate).
  upsertUniverseEntry({
    id: `bank:user:${opts.userId}`,
    kind: "bank",
    relativePath: userRel,
    ownerKind: "user",
    ownerId: opts.userId,
    label: "Bank (You)",
  });
  upsertUniverseEntry({
    id: `bank:agent:${intelId}`,
    kind: "bank",
    relativePath: intelRel,
    ownerKind: "agent",
    ownerId: intelId,
    label: "Bank (Intelligence)",
  });
  // Fold Account / Cloud / Workspace handles into User Vault (registry + schema).
  for (const slot of ["account", "cloud", "workspace"] as const) {
    upsertUniverseEntry({
      id: `vault-slot:user:${opts.userId}:${slot}`,
      kind: "vault_slot",
      relativePath: userRel,
      ownerKind: "user",
      ownerId: opts.userId,
      label: slot[0]!.toUpperCase() + slot.slice(1),
    });
  }
  seedVaultPlaneSchema(userHit.absolutePath, {
    ownerKind: "user",
    ownerId: opts.userId,
  });
  seedVaultPlaneSchema(intelHit.absolutePath, {
    ownerKind: "agent",
    ownerId: intelId,
  });
  return {
    userVault: {
      relativePath: userHit.relativePath,
      absolutePath: userHit.absolutePath,
    },
    intelligenceVault: {
      relativePath: intelHit.relativePath,
      absolutePath: intelHit.absolutePath,
    },
  };
}

function seedVaultPlaneSchema(
  absolutePath: string,
  owner: { ownerKind: string; ownerId: string }
): void {
  const db = new Database(absolutePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vault_handles (
      handle_kind TEXT NOT NULL,
      handle_id TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (handle_kind, handle_id)
    );
    CREATE TABLE IF NOT EXISTS bank_links (
      link_id TEXT PRIMARY KEY,
      label TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO vault_meta (key, value, updated_at)
     VALUES ('owner_kind', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(owner.ownerKind);
  db.prepare(
    `INSERT INTO vault_meta (key, value, updated_at)
     VALUES ('owner_id', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(owner.ownerId);
  if (owner.ownerKind === "user") {
    for (const kind of ["account", "cloud", "workspace"] as const) {
      db.prepare(
        `INSERT INTO vault_handles (handle_kind, handle_id, payload_json, updated_at)
         VALUES (?, 'local', '{}', datetime('now'))
         ON CONFLICT(handle_kind, handle_id) DO NOTHING`
      ).run(kind);
    }
  }
  db.close();
}

/** Phase 6: surface DB stubs (Structure / Knowledge / Automations / Calendar). */
export function ensureSurfaceUniverseFile(opts: {
  kind: "structure" | "knowledge" | "automations" | "calendar";
  id: string;
  ownerUserId?: string;
  ownerAgentId?: string;
  label?: string;
}): { relativePath: string; absolutePath: string } {
  const relativePath = `surfaces/${opts.kind}/${opts.id}.sqlite`;
  const prepared = prepareOpenSet([relativePath]);
  const hit = prepared.opened[0];
  if (!hit) {
    throw new Error(prepared.rejected[0]?.error ?? "surface ensure failed");
  }
  upsertUniverseEntry({
    id: `surface:${opts.kind}:${opts.id}`,
    kind: opts.kind,
    relativePath,
    ownerKind: opts.ownerUserId ? "user" : "agent",
    ownerId: opts.ownerUserId ?? opts.ownerAgentId ?? "intelligence",
    label: opts.label ?? opts.kind,
  });
  return { relativePath: hit.relativePath, absolutePath: hit.absolutePath };
}
