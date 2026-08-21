/**
 * Local platform snapshot (SQLite + DuckDB timeseries) for Admin / cron parity.
 * Optional S3 remains operator-owned via scripts/backup/snapshot-platform.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { listAllTenantIds, type CoreDatabase } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { getUserDb } from "../user-registry.js";
import { getHostUsersDb } from "../host-users-db.js";
import { getTimeseriesStore } from "./timeseries-store.js";
import { backupPluginDataTree } from "./plugin-sqlite.js";

export type PlatformBackupResult = {
  status: "ok" | "failed";
  localPath: string | null;
  remoteUri: null;
  error: string | null;
  updatedAt: string;
};

export function backupLocalDir(): string {
  const configured = config.backups.localDir.trim();
  return configured || path.join(config.dataDir, "backups");
}

async function backupSqlite(
  db: Database.Database,
  destFile: string
): Promise<void> {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  await db.backup(destFile);
  const verification = new Database(destFile, { readonly: true });
  try {
    const result = verification.pragma("quick_check", { simple: true });
    if (result !== "ok") {
      throw new Error(`Snapshot verification failed: ${String(result)}`);
    }
  } finally {
    verification.close();
  }
}

function writeBackupMeta(
  core: CoreDatabase,
  row: {
    status: string;
    localPath: string | null;
    remoteUri: string | null;
    error: string | null;
  }
): void {
  core.exec(`
    CREATE TABLE IF NOT EXISTS platform_backup_meta (
      id TEXT PRIMARY KEY CHECK (id = 'latest'),
      status TEXT NOT NULL,
      local_path TEXT,
      remote_uri TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  core
    .prepare(
      `INSERT INTO platform_backup_meta (id, status, local_path, remote_uri, error, updated_at)
       VALUES ('latest', ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         status=excluded.status,
         local_path=excluded.local_path,
         remote_uri=excluded.remote_uri,
         error=excluded.error,
         updated_at=datetime('now')`
    )
    .run(row.status, row.localPath, row.remoteUri, row.error);
}

/** Run a local SQLite + DuckDB timeseries snapshot and update platform_backup_meta. */
export async function runLocalPlatformBackup(
  core: CoreDatabase
): Promise<PlatformBackupResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupLocalDir(), stamp);
  try {
    fs.mkdirSync(path.join(dest, "databases"), { recursive: true });
    fs.mkdirSync(path.join(dest, "tenants"), { recursive: true });
    fs.mkdirSync(path.join(dest, "users"), { recursive: true });

    await backupSqlite(core, path.join(dest, "databases", "Cloud.sqlite"));
    // Keep legacy archive name for older restore tools.
    await backupSqlite(core, path.join(dest, "databases", "core.sqlite"));
    await backupSqlite(
      getHostUsersDb(),
      path.join(dest, "databases", "Users.sqlite")
    );

    for (const tenantId of listAllTenantIds(core)) {
      const safe = tenantId.replace(/[^a-zA-Z0-9._-]/g, "_");
      await backupSqlite(
        getTenantDb(tenantId),
        path.join(dest, "tenants", `${safe}.sqlite`)
      );
    }

    const userIds = core
      .prepare(`SELECT id FROM users`)
      .all() as Array<{ id: string }>;
    for (const { id: userId } of userIds) {
      const safe = userId.replace(/[^a-zA-Z0-9._-]/g, "_");
      const userFile = path.join(config.usersDir, `${safe}.sqlite`);
      if (!fs.existsSync(userFile)) continue;
      await backupSqlite(
        getUserDb(userId),
        path.join(dest, "users", `${safe}.sqlite`)
      );
    }

    const duckdbFiles = await getTimeseriesStore().snapshotAnalyticsTo(
      path.join(dest, "timeseries")
    );

    const pluginDataFiles = await backupPluginDataTree(
      path.join(dest, "plugin-data"),
      backupSqlite
    );

    fs.writeFileSync(
      path.join(dest, "manifest.json"),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          dataDir: config.dataDir,
          dest,
          source: "admin",
          includes: {
            sqlite: true,
            duckdbTimeseries: duckdbFiles,
            pluginData: pluginDataFiles,
          },
        },
        null,
        2
      )
    );

    writeBackupMeta(core, {
      status: "ok",
      localPath: dest,
      remoteUri: null,
      error: null,
    });

    return {
      status: "ok",
      localPath: dest,
      remoteUri: null,
      error: null,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      writeBackupMeta(core, {
        status: "failed",
        localPath: dest,
        remoteUri: null,
        error: message,
      });
    } catch {
      /* meta write best-effort */
    }
    return {
      status: "failed",
      localPath: dest,
      remoteUri: null,
      error: message,
      updatedAt: new Date().toISOString(),
    };
  }
}
