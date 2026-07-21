import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { AppDatabase } from "../db.js";
import { config } from "../config.js";

export interface StorageEntry {
  id: string;
  label: string;
  path: string;
  bytes: number;
  kind: "sqlite" | "dir" | "file" | "parquet_dataset";
  detail?: string;
}

export interface StorageUsageReport {
  entries: StorageEntry[];
  totalBytes: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  largestTables: Array<{ name: string; bytes: number; rows: number }>;
  parquetDatasets: Array<{ dataset: string; bytes: number; files: number }>;
}

function safeStat(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) total += dirSize(full);
    else total += safeStat(full);
  }
  return total;
}

function countFilesInDir(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) n += countFilesInDir(full);
    else n += 1;
  }
  return n;
}

function diskSpace(): { free: number | null; total: number | null } {
  try {
    if (process.platform === "win32") {
      const drive = config.dataDir.slice(0, 2);
      const out = execSync(
        `powershell -NoProfile -Command "(Get-PSDrive -Name '${drive[0]}').Free,(Get-PSDrive -Name '${drive[0]}').Used"`,
        { encoding: "utf8" }
      );
      const [free, used] = out.trim().split(/\s+/).map(Number);
      if (Number.isFinite(free) && Number.isFinite(used)) {
        return { free, total: free + used };
      }
    }
    const { statfsSync } = fs as typeof fs & {
      statfsSync?: (p: string) => { bfree: number; blocks: number; bsize: number };
    };
    if (statfsSync) {
      const s = statfsSync(config.dataDir);
      return { free: s.bfree * s.bsize, total: s.blocks * s.bsize };
    }
  } catch {
    /* ignore */
  }
  return { free: null, total: null };
}

function largestTables(db: AppDatabase): Array<{ name: string; bytes: number; rows: number }> {
  try {
    const rows = db
      .prepare(
        `SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 15`
      )
      .all() as Array<{ name: string; bytes: number }>;
    return rows.map((r) => {
      let rowCount = 0;
      try {
        const c = db.prepare(`SELECT COUNT(*) AS c FROM "${r.name}"`).get() as { c: number };
        rowCount = c.c;
      } catch {
        /* virtual table */
      }
      return { name: r.name, bytes: Number(r.bytes ?? 0), rows: rowCount };
    });
  } catch {
    // dbstat unavailable — fall back to row counts only for known large tables
    const tables = [
      "ai_messages",
      "events",
      "platform_action_log",
    ];
    return tables
      .map((name) => {
        try {
          const c = db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number };
          return { name, bytes: 0, rows: c.c };
        } catch {
          return null;
        }
      })
      .filter((x): x is { name: string; bytes: number; rows: number } => x != null)
      .sort((a, b) => b.rows - a.rows);
  }
}

function parquetBreakdown(): Array<{ dataset: string; bytes: number; files: number }> {
  const root = path.join(config.dataDir, "timeseries");
  if (!fs.existsSync(root)) return [];
  const out: Array<{ dataset: string; bytes: number; files: number }> = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const full = path.join(root, ent.name);
    out.push({
      dataset: ent.name,
      bytes: dirSize(full),
      files: countFilesInDir(full),
    });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

export function getStorageUsage(db: AppDatabase): StorageUsageReport {
  const entries: StorageEntry[] = [];
  const dbPath = config.dbPath;
  entries.push({
    id: "platform_db",
    label: "platform.db",
    path: dbPath,
    bytes: safeStat(dbPath),
    kind: "sqlite",
  });
  entries.push({
    id: "platform_wal",
    label: "platform.db-wal",
    path: `${dbPath}-wal`,
    bytes: safeStat(`${dbPath}-wal`),
    kind: "file",
  });
  entries.push({
    id: "platform_shm",
    label: "platform.db-shm",
    path: `${dbPath}-shm`,
    bytes: safeStat(`${dbPath}-shm`),
    kind: "file",
  });

  const backupsDir = path.join(config.dataDir, "backups");
  const backupBytes = dirSize(backupsDir);
  entries.push({
    id: "backups",
    label: "Database backups",
    path: backupsDir,
    bytes: backupBytes,
    kind: "dir",
    detail: `${countFilesInDir(backupsDir)} files`,
  });

  const agentsDir = config.agentsDir;
  entries.push({
    id: "agents",
    label: "Agent workspaces",
    path: agentsDir,
    bytes: dirSize(agentsDir),
    kind: "dir",
  });

  const ipcDir = config.ipcDir;
  entries.push({
    id: "ipc",
    label: "Trading IPC files",
    path: ipcDir,
    bytes: dirSize(ipcDir),
    kind: "dir",
  });

  const timeseriesDir = path.join(config.dataDir, "timeseries");
  const tsBytes = dirSize(timeseriesDir);
  entries.push({
    id: "timeseries",
    label: "Parquet time-series (cold store)",
    path: timeseriesDir,
    bytes: tsBytes,
    kind: "dir",
  });

  const parquetDatasets = parquetBreakdown();
  for (const ds of parquetDatasets) {
    entries.push({
      id: `parquet_${ds.dataset}`,
      label: `Parquet: ${ds.dataset}`,
      path: path.join(timeseriesDir, ds.dataset),
      bytes: ds.bytes,
      kind: "parquet_dataset",
      detail: `${ds.files} files`,
    });
  }

  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  const disk = diskSpace();

  return {
    entries,
    totalBytes,
    diskFreeBytes: disk.free,
    diskTotalBytes: disk.total,
    largestTables: largestTables(db),
    parquetDatasets,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
