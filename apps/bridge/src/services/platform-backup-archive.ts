/**
 * Safe stamp resolution + streaming tar.gz for Admin platform backup download.
 * Archives only closed stamps under backups/; never live DB paths.
 */
import fs from "node:fs";
import path from "node:path";
import { createGzip } from "node:zlib";
import { Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import type { CoreDatabase } from "../core-db.js";
import { backupLocalDir } from "./platform-backup.js";

/** Stamp folder names from ISO timestamps (colons/dots replaced). */
export const BACKUP_STAMP_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{1,6}Z$/;

const SECRET_NAME_RE =
  /(^|[/\\])(\.env|\.env\..+|.*credentials.*|.*secret.*|.*\.pem|\.aws|id_rsa|id_ed25519)([/\\]|$)/i;

export type BackupStampInfo = {
  stamp: string;
  path: string;
  createdAt: string | null;
  hasManifest: boolean;
  bytes: number;
};

export { backupLocalDir };

function dirByteSize(root: string): number {
  let total = 0;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(root);
  return total;
}

/** List closed stamp directories under backups/ (newest first). */
export function listBackupStamps(limit = 50): BackupStampInfo[] {
  const root = backupLocalDir();
  if (!fs.existsSync(root)) return [];
  const names = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && BACKUP_STAMP_RE.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse()
    .slice(0, Math.max(1, Math.min(limit, 200)));

  return names.map((stamp) => {
    const stampPath = path.join(root, stamp);
    const manifestPath = path.join(stampPath, "manifest.json");
    let createdAt: string | null = null;
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
          createdAt?: unknown;
        };
        if (typeof raw.createdAt === "string") createdAt = raw.createdAt;
      } catch {
        /* ignore bad manifest */
      }
    }
    return {
      stamp,
      path: stampPath,
      createdAt,
      hasManifest: fs.existsSync(manifestPath),
      bytes: dirByteSize(stampPath),
    };
  });
}

export class BackupStampError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "BackupStampError";
  }
}

/**
 * Resolve a stamp id (or "latest") to an absolute directory strictly under backups/.
 * Rejects path traversal, symlinks that escape, and incomplete stamps.
 */
export function resolveBackupStampDir(stampOrLatest: string): {
  stamp: string;
  dir: string;
} {
  const root = path.resolve(backupLocalDir());
  let stamp = stampOrLatest.trim();
  if (!stamp || stamp === "latest") {
    const stamps = listBackupStamps(1);
    if (stamps.length === 0) {
      throw new BackupStampError(404, "No backup stamps found");
    }
    stamp = stamps[0]!.stamp;
  }
  if (!BACKUP_STAMP_RE.test(stamp)) {
    throw new BackupStampError(400, "Invalid backup stamp id");
  }
  if (stamp.includes("..") || stamp.includes("/") || stamp.includes("\\")) {
    throw new BackupStampError(400, "Invalid backup stamp id");
  }

  const candidate = path.resolve(root, stamp);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    throw new BackupStampError(400, "Invalid backup stamp path");
  }

  let realRoot: string;
  let realCandidate: string;
  try {
    if (!fs.existsSync(root)) {
      throw new BackupStampError(404, "Backups directory missing");
    }
    realRoot = fs.realpathSync(root);
    if (!fs.existsSync(candidate)) {
      throw new BackupStampError(404, "Backup stamp not found");
    }
    realCandidate = fs.realpathSync(candidate);
  } catch (err) {
    if (err instanceof BackupStampError) throw err;
    throw new BackupStampError(404, "Backup stamp not found");
  }

  const realRootSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRootSep)) {
    throw new BackupStampError(400, "Invalid backup stamp path");
  }

  const st = fs.statSync(realCandidate);
  if (!st.isDirectory()) {
    throw new BackupStampError(404, "Backup stamp not found");
  }

  // Prefer closed stamps: require manifest.json written at end of snapshot.
  if (!fs.existsSync(path.join(realCandidate, "manifest.json"))) {
    throw new BackupStampError(
      409,
      "Backup stamp is incomplete (missing manifest.json)"
    );
  }

  return { stamp, dir: realCandidate };
}

function shouldIncludeArchivePath(relPosix: string): boolean {
  if (!relPosix || relPosix === ".") return false;
  if (SECRET_NAME_RE.test(relPosix)) return false;
  // Only pack known stamp layout (and any nested files under those trees).
  const top = relPosix.split("/")[0]!;
  return (
    top === "databases" ||
    top === "tenants" ||
    top === "timeseries" ||
    top === "manifest.json"
  );
}

function collectStampFiles(stampDir: string): Array<{ abs: string; rel: string; size: number }> {
  const out: Array<{ abs: string; rel: string; size: number }> = [];
  const walk = (dir: string, relBase: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const relPosix = rel.split(path.sep).join("/");
      if (ent.isSymbolicLink()) {
        // Do not follow symlinks out of the stamp.
        continue;
      }
      if (ent.isDirectory()) {
        if (!shouldIncludeArchivePath(relPosix) && relPosix !== "databases" && relPosix !== "tenants" && relPosix !== "timeseries") {
          continue;
        }
        walk(abs, relPosix);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!shouldIncludeArchivePath(relPosix)) continue;
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        continue;
      }
      out.push({ abs, rel: relPosix, size });
    }
  };
  walk(stampDir, "");
  return out;
}

function tarHeader(name: string, size: number, mtimeSec: number): Buffer {
  const buf = Buffer.alloc(512, 0);
  const nameBytes = Buffer.from(name, "utf8");
  if (nameBytes.length > 100) {
    // ustar prefix/name split for longer paths
    const prefix = name.slice(0, Math.min(155, name.lastIndexOf("/")));
    const shortName = name.slice(prefix.length + 1);
    if (
      Buffer.from(prefix, "utf8").length > 155 ||
      Buffer.from(shortName, "utf8").length > 100
    ) {
      throw new Error(`Path too long for ustar: ${name}`);
    }
    Buffer.from(shortName, "utf8").copy(buf, 0);
    Buffer.from(prefix, "utf8").copy(buf, 345);
  } else {
    nameBytes.copy(buf, 0);
  }
  Buffer.from("0000644\0", "utf8").copy(buf, 100); // mode
  Buffer.from("0000000\0", "utf8").copy(buf, 108); // uid
  Buffer.from("0000000\0", "utf8").copy(buf, 116); // gid
  const sizeOct = size.toString(8).padStart(11, "0") + "\0";
  Buffer.from(sizeOct, "utf8").copy(buf, 124);
  const mtimeOct = Math.floor(mtimeSec).toString(8).padStart(11, "0") + "\0";
  Buffer.from(mtimeOct, "utf8").copy(buf, 136);
  Buffer.from("        ", "utf8").copy(buf, 148); // checksum placeholder
  buf[156] = 0x30; // typeflag '0' regular file
  Buffer.from("ustar\0", "utf8").copy(buf, 257);
  Buffer.from("00", "utf8").copy(buf, 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i]!;
  const checksum = sum.toString(8).padStart(6, "0") + "\0 ";
  Buffer.from(checksum, "utf8").copy(buf, 148);
  return buf;
}

/** Async generator of tar bytes for a stamp directory (gzip applied by caller). */
async function* tarStampEntries(
  stamp: string,
  stampDir: string
): AsyncGenerator<Buffer> {
  const files = collectStampFiles(stampDir);
  const now = Math.floor(Date.now() / 1000);
  for (const file of files) {
    const archiveName = `${stamp}/${file.rel}`;
    yield tarHeader(archiveName, file.size, now);
    const fh = await fs.promises.open(file.abs, "r");
    try {
      const chunk = Buffer.alloc(64 * 1024);
      let remaining = file.size;
      while (remaining > 0) {
        const toRead = Math.min(chunk.length, remaining);
        const { bytesRead } = await fh.read(chunk, 0, toRead, null);
        if (bytesRead <= 0) break;
        yield Buffer.from(chunk.subarray(0, bytesRead));
        remaining -= bytesRead;
      }
      if (remaining !== 0) {
        throw new Error(`Short read for ${file.rel}`);
      }
    } finally {
      await fh.close();
    }
    const pad = (512 - (file.size % 512)) % 512;
    if (pad) yield Buffer.alloc(pad, 0);
  }
  // Two zero blocks end the archive.
  yield Buffer.alloc(1024, 0);
}

/** Stream stamp as application/gzip tar to a writable (e.g. HTTP response). */
export async function streamBackupStampTarGz(
  stamp: string,
  stampDir: string,
  dest: Writable
): Promise<{ bytesIn: number; fileCount: number }> {
  const files = collectStampFiles(stampDir);
  const bytesIn = files.reduce((s, f) => s + f.size, 0);
  const tarReadable = Readable.from(tarStampEntries(stamp, stampDir));
  const gzip = createGzip({ level: 6 });
  await pipeline(tarReadable, gzip, dest);
  return { bytesIn, fileCount: files.length };
}

export function logBackupDownloadAudit(
  core: CoreDatabase,
  entry: {
    userId: string;
    stamp: string;
    bytesIn: number;
    fileCount: number;
    result: "ok" | "failed";
    error?: string | null;
  }
): void {
  try {
    core.exec(`
      CREATE TABLE IF NOT EXISTS platform_action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        scope TEXT,
        payload_hash TEXT,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify({
          userId: entry.userId,
          stamp: entry.stamp,
          bytesIn: entry.bytesIn,
          fileCount: entry.fileCount,
          error: entry.error ?? null,
        })
      )
      .digest("hex")
      .slice(0, 16);
    core
      .prepare(
        `INSERT INTO platform_action_log (agent_id, action, scope, payload_hash, result)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        `admin:${entry.userId}`,
        "platform.backup.download",
        `backup:${entry.stamp}`,
        payloadHash,
        entry.result === "ok" ? "ok" : `failed:${entry.error ?? "error"}`
      );
  } catch {
    /* never break download on audit failure */
  }
}

/** Exported for unit tests. */
export const __test = {
  shouldIncludeArchivePath,
  collectStampFiles,
  SECRET_NAME_RE,
};
