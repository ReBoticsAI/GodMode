import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import type { AppDatabase } from "../db.js";

export interface AiAdapter {
  id: string;
  name: string;
  path: string;
  description: string | null;
  domain: string | null;
  enabled: number;
  default_scale: number;
  created_at: string;
  updated_at: string;
}

/** Raw scan of the adapters directory for *.gguf files. */
export function scanAdapterFiles(): string[] {
  const dir = config.ai.adaptersDir;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".gguf"))
    .map((f) => path.join(dir, f));
}

/** All registered adapters, deterministically ordered (this order maps 1:1 to
 *  the `--lora` flag order, which is how llama-server indexes adapters). */
export function listAdapters(db: AppDatabase): AiAdapter[] {
  return db
    .prepare(
      `SELECT id, name, path, description, domain, enabled, default_scale, created_at, updated_at
       FROM ai_adapters ORDER BY created_at ASC, id ASC`
    )
    .all() as AiAdapter[];
}

/** Enabled adapters whose backing file still exists, in launch order. */
export function listEnabledAdapters(db: AppDatabase): AiAdapter[] {
  return listAdapters(db).filter((a) => a.enabled === 1 && fs.existsSync(a.path));
}

export function getAdapter(db: AppDatabase, id: string): AiAdapter | null {
  return (
    (db
      .prepare(
        `SELECT id, name, path, description, domain, enabled, default_scale, created_at, updated_at
         FROM ai_adapters WHERE id = ?`
      )
      .get(id) as AiAdapter | undefined) ?? null
  );
}

export function createAdapter(
  db: AppDatabase,
  input: {
    name: string;
    path: string;
    description?: string | null;
    domain?: string | null;
    enabled?: boolean;
    defaultScale?: number;
  }
): AiAdapter {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ai_adapters (id, name, path, description, domain, enabled, default_scale)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.path,
    input.description ?? null,
    input.domain ?? null,
    input.enabled === false ? 0 : 1,
    Number.isFinite(input.defaultScale) ? Number(input.defaultScale) : 1.0
  );
  return getAdapter(db, id)!;
}

export function updateAdapter(
  db: AppDatabase,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    domain?: string | null;
    enabled?: boolean;
    defaultScale?: number;
  }
): AiAdapter | null {
  const existing = getAdapter(db, id);
  if (!existing) return null;
  if (patch.name != null)
    db.prepare(`UPDATE ai_adapters SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(
      String(patch.name),
      id
    );
  if (patch.description !== undefined)
    db.prepare(
      `UPDATE ai_adapters SET description = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.description == null ? null : String(patch.description), id);
  if (patch.domain !== undefined)
    db.prepare(
      `UPDATE ai_adapters SET domain = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.domain == null ? null : String(patch.domain), id);
  if (patch.enabled != null)
    db.prepare(
      `UPDATE ai_adapters SET enabled = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.enabled ? 1 : 0, id);
  if (patch.defaultScale != null && Number.isFinite(Number(patch.defaultScale)))
    db.prepare(
      `UPDATE ai_adapters SET default_scale = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(Number(patch.defaultScale), id);
  return getAdapter(db, id);
}

export function deleteAdapter(db: AppDatabase, id: string): boolean {
  return db.prepare(`DELETE FROM ai_adapters WHERE id = ?`).run(id).changes > 0;
}

/**
 * Registers any *.gguf file in the adapters directory that is not already
 * tracked in the DB, so newly trained adapters appear automatically. Returns
 * the number of newly registered adapters.
 */
export function syncAdaptersFromDisk(db: AppDatabase): number {
  const known = new Set(listAdapters(db).map((a) => path.resolve(a.path)));
  let added = 0;
  for (const file of scanAdapterFiles()) {
    if (known.has(path.resolve(file))) continue;
    createAdapter(db, {
      name: path.basename(file, ".gguf"),
      path: file,
      domain: null,
      enabled: false,
      defaultScale: 1.0,
    });
    added += 1;
  }
  return added;
}
