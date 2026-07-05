import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../../db.js";

export interface ToolAuditEntry {
  agentId: string;
  userId?: string | null;
  action: string;
  path?: string | null;
  cwd?: string | null;
  command?: string | null;
  exitCode?: number | null;
  bytesOut?: number | null;
  result?: string | null;
}

export function ensureToolAuditTable(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_audit_log (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      path TEXT,
      cwd TEXT,
      command TEXT,
      exit_code INTEGER,
      bytes_out INTEGER,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS tool_audit_log_by_ts
      ON tool_audit_log(created_at DESC);
  `);
}

export function logToolAudit(db: AppDatabase, entry: ToolAuditEntry): void {
  ensureToolAuditTable(db);
  db.prepare(
    `INSERT INTO tool_audit_log
       (id, agent_id, user_id, action, path, cwd, command, exit_code, bytes_out, result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuidv4(),
    entry.agentId,
    entry.userId ?? null,
    entry.action,
    entry.path ?? null,
    entry.cwd ?? null,
    entry.command ?? null,
    entry.exitCode ?? null,
    entry.bytesOut ?? null,
    entry.result ?? null
  );
}
