import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "../config.js";

const BACKUP_KEEP = Number(process.env.DB_BACKUP_KEEP ?? 7);
const BACKUP_INTERVAL_MS = Number(process.env.DB_BACKUP_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
const CHECKPOINT_INTERVAL_MS = Number(process.env.DB_CHECKPOINT_INTERVAL_MS ?? 30 * 60 * 1000);

function backupsDir(): string {
  return path.join(config.dataDir, "backups");
}

function rotateBackups(dir: string, keep: number): void {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("platform-") && f.endsWith(".db"))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const old of files.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, old.f));
    } catch {
      /* ignore */
    }
  }
}

export function runIntegrityCheck(db: Database.Database): string {
  const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  const result = row?.integrity_check ?? "unknown";
  if (result !== "ok") {
    console.error(`[db] integrity_check: ${result}`);
  } else {
    console.log("[db] integrity_check: ok");
  }
  return result;
}

export function runWalCheckpoint(db: Database.Database, mode: "PASSIVE" | "TRUNCATE" = "TRUNCATE"): void {
  try {
    db.pragma(`wal_checkpoint(${mode})`);
  } catch (err) {
    console.warn("[db] wal_checkpoint failed:", err instanceof Error ? err.message : err);
  }
}

export function runVacuumIntoBackup(db: Database.Database): string | null {
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `platform-${ts}.db`);
  try {
    db.prepare(`VACUUM INTO ?`).run(dest);
    rotateBackups(dir, BACKUP_KEEP);
    console.log(`[db] backup written: ${dest}`);
    return dest;
  } catch (err) {
    console.warn("[db] VACUUM INTO backup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function startDbMaintenance(db: Database.Database): () => void {
  runIntegrityCheck(db);

  const backupTimer = setInterval(() => {
    runVacuumIntoBackup(db);
  }, BACKUP_INTERVAL_MS);

  const checkpointTimer = setInterval(() => {
    runWalCheckpoint(db, "TRUNCATE");
  }, CHECKPOINT_INTERVAL_MS);

  // Unref so timers don't keep the process alive alone.
  backupTimer.unref?.();
  checkpointTimer.unref?.();

  return () => {
    clearInterval(backupTimer);
    clearInterval(checkpointTimer);
  };
}
