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
