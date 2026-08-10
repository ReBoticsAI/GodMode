import fs from "node:fs";
import path from "node:path";

export const GODMODE_DATA_DIR_NAME = "GodMode";
export const LEGACY_DATA_DIR_NAME = "TradingPlatform";

/**
 * On first boot after rebrand, rename %APPDATA%\TradingPlatform → %APPDATA%\GodMode.
 * Skipped when PLATFORM_DATA_DIR is set explicitly.
 */
export function migrateLegacyDataDir(newDir: string, legacyDir: string): void {
  if (newDir === legacyDir) return;
  if (process.env.PLATFORM_DATA_DIR) return;

  const newExists = fs.existsSync(newDir);
  const legacyExists = fs.existsSync(legacyDir);

  if (newExists && legacyExists) {
    console.warn(
      `[GodMode] Both data dirs exist; using ${newDir}. Legacy ${legacyDir} was not modified.`
    );
    return;
  }

  if (!newExists && legacyExists) {
    try {
      fs.renameSync(legacyDir, newDir);
      console.log(
        `[GodMode] Migrated data dir ${LEGACY_DATA_DIR_NAME} → ${GODMODE_DATA_DIR_NAME}`
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
        console.warn(
          `[GodMode] Could not migrate ${legacyDir} → ${newDir} (${code}: files in use). ` +
            `Using ${legacyDir} until Bridge/SC release locks; restart to retry migration.`
        );
        return;
      }
      console.error(
        `[GodMode] Failed to migrate ${legacyDir} → ${newDir}:`,
        err instanceof Error ? err.message : err
      );
      throw err;
    }
  }
}

/** Default platform data dir under APPDATA (or homedir fallback on non-Windows). */
export function defaultPlatformDataDir(appDataRoot: string): string {
  const newDir = path.join(appDataRoot, GODMODE_DATA_DIR_NAME);
  const legacyDir = path.join(appDataRoot, LEGACY_DATA_DIR_NAME);
  migrateLegacyDataDir(newDir, legacyDir);
  if (fs.existsSync(newDir)) return newDir;
  if (fs.existsSync(legacyDir)) return legacyDir;
  return newDir;
}

export const CLOUD_DB_FILENAME = "Cloud.sqlite";
export const LEGACY_CLOUD_DB_FILENAME = "core.sqlite";

function renameSqliteWithSidecars(fromMain: string, toMain: string): void {
  fs.renameSync(fromMain, toMain);
  for (const suffix of ["-wal", "-shm"] as const) {
    const fromSide = `${fromMain}${suffix}`;
    const toSide = `${toMain}${suffix}`;
    if (!fs.existsSync(fromSide)) continue;
    if (fs.existsSync(toSide)) {
      try {
        fs.unlinkSync(fromSide);
      } catch {
        /* leave orphan sidecar; main file already moved */
      }
      continue;
    }
    fs.renameSync(fromSide, toSide);
  }
}

/**
 * Prefer live Cloud.sqlite. If missing and legacy core.sqlite exists, rename
 * (including WAL/SHM). If both exist, keep Cloud and leave core untouched.
 */
export function ensureCloudDbFilename(dataDir: string): void {
  const cloudPath = path.join(dataDir, CLOUD_DB_FILENAME);
  const legacyPath = path.join(dataDir, LEGACY_CLOUD_DB_FILENAME);
  const cloudExists = fs.existsSync(cloudPath);
  const legacyExists = fs.existsSync(legacyPath);

  if (cloudExists && legacyExists) {
    console.warn(
      `[GodMode] Both ${CLOUD_DB_FILENAME} and ${LEGACY_CLOUD_DB_FILENAME} exist under ${dataDir}; using ${CLOUD_DB_FILENAME}.`
    );
    return;
  }

  if (!cloudExists && legacyExists) {
    try {
      renameSqliteWithSidecars(legacyPath, cloudPath);
      console.log(
        `[GodMode] Migrated Cloud DB ${LEGACY_CLOUD_DB_FILENAME} → ${CLOUD_DB_FILENAME}`
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
        console.warn(
          `[GodMode] Could not migrate ${legacyPath} → ${cloudPath} (${code}: files in use). ` +
            `Using ${LEGACY_CLOUD_DB_FILENAME} until Bridge releases locks; restart to retry.`
        );
        return;
      }
      console.error(
        `[GodMode] Failed to migrate ${legacyPath} → ${cloudPath}:`,
        err instanceof Error ? err.message : err
      );
      throw err;
    }
  }
}

/** Resolved live Cloud DB path after ensureCloudDbFilename (Cloud, else legacy core). */
export function resolveCloudDbPath(dataDir: string): string {
  ensureCloudDbFilename(dataDir);
  const cloudPath = path.join(dataDir, CLOUD_DB_FILENAME);
  const legacyPath = path.join(dataDir, LEGACY_CLOUD_DB_FILENAME);
  if (fs.existsSync(cloudPath)) return cloudPath;
  if (fs.existsSync(legacyPath)) return legacyPath;
  return cloudPath;
}
