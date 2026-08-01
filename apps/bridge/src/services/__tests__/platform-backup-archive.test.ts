/**
 * Path safety + archive inclusion for platform backup download (#243).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createGunzip } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gm-backup-dl-"));
const backupsDir = path.join(tmpRoot, "backups");

vi.mock("../../config.js", () => ({
  config: {
    dataDir: tmpRoot,
    backups: { localDir: backupsDir },
    isSaas: false,
    isHub: false,
  },
}));

const {
  BACKUP_STAMP_RE,
  BackupStampError,
  listBackupStamps,
  resolveBackupStampDir,
  streamBackupStampTarGz,
  __test,
} = await import("../platform-backup-archive.js");

function writeClosedStamp(stamp: string, extras?: Record<string, string>) {
  const dir = path.join(backupsDir, stamp);
  fs.mkdirSync(path.join(dir, "databases"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tenants"), { recursive: true });
  fs.mkdirSync(path.join(dir, "timeseries", "tenant=platform"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(dir, "databases", "core.sqlite"), "core-bytes");
  fs.writeFileSync(path.join(dir, "tenants", "t1.sqlite"), "tenant-bytes");
  fs.writeFileSync(
    path.join(dir, "timeseries", "tenant=platform", "analytics.duckdb"),
    "duck-bytes"
  );
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ createdAt: "2026-07-31T12:00:00.000Z", dest: dir })
  );
  if (extras) {
    for (const [rel, body] of Object.entries(extras)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
  }
  return dir;
}

describe("platform-backup-archive", () => {
  beforeEach(() => {
    fs.rmSync(backupsDir, { recursive: true, force: true });
    fs.mkdirSync(backupsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(backupsDir, { recursive: true, force: true });
  });

  it("accepts ISO-style stamp ids only", () => {
    expect(BACKUP_STAMP_RE.test("2026-07-31T12-00-00-000Z")).toBe(true);
    expect(BACKUP_STAMP_RE.test("../etc")).toBe(false);
    expect(BACKUP_STAMP_RE.test("2026-07-31T12:00:00.000Z")).toBe(false);
    expect(BACKUP_STAMP_RE.test("latest")).toBe(false);
  });

  it("lists stamps newest first and resolves latest", () => {
    writeClosedStamp("2026-07-30T01-00-00-000Z");
    writeClosedStamp("2026-07-31T02-00-00-000Z");
    const listed = listBackupStamps();
    expect(listed.map((s) => s.stamp)).toEqual([
      "2026-07-31T02-00-00-000Z",
      "2026-07-30T01-00-00-000Z",
    ]);
    const latest = resolveBackupStampDir("latest");
    expect(latest.stamp).toBe("2026-07-31T02-00-00-000Z");
  });

  it("rejects path traversal and unknown stamps", () => {
    writeClosedStamp("2026-07-31T12-00-00-000Z");
    expect(() => resolveBackupStampDir("..")).toThrow(BackupStampError);
    expect(() => resolveBackupStampDir("../backups")).toThrow(BackupStampError);
    expect(() => resolveBackupStampDir("nope")).toThrow(BackupStampError);
    expect(() => resolveBackupStampDir("2026-07-31T99-00-00-000Z")).toThrow(
      BackupStampError
    );
    try {
      resolveBackupStampDir("../../../etc");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BackupStampError);
      expect((err as BackupStampError).status).toBe(400);
    }
  });

  it("rejects incomplete stamps without manifest", () => {
    const stamp = "2026-07-31T12-00-00-001Z";
    const dir = path.join(backupsDir, stamp);
    fs.mkdirSync(path.join(dir, "databases"), { recursive: true });
    fs.writeFileSync(path.join(dir, "databases", "core.sqlite"), "x");
    expect(() => resolveBackupStampDir(stamp)).toThrow(/incomplete/i);
  });

  it("excludes secret-looking paths from the archive", () => {
    expect(__test.shouldIncludeArchivePath("databases/core.sqlite")).toBe(true);
    expect(__test.shouldIncludeArchivePath("manifest.json")).toBe(true);
    expect(__test.shouldIncludeArchivePath(".env")).toBe(false);
    expect(__test.shouldIncludeArchivePath("secrets/credentials.json")).toBe(
      false
    );
    expect(__test.shouldIncludeArchivePath("other/file.txt")).toBe(false);
  });

  it("admin marketplace router gates download behind platform admin + rate limit", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const routePath = fileURLToPath(
      new URL("../../routes/admin-marketplace.ts", import.meta.url)
    );
    const text = readFileSync(routePath, "utf8");
    expect(text).toMatch(/requirePlatformAdmin/);
    expect(text).toMatch(
      /router\.use\(attachAuthContext,\s*requireAuth,\s*requirePlatformAdmin\)/
    );
    expect(text).toMatch(/backup\/download/);
    expect(text).toMatch(/backupDownloadLimiter/);
    expect(text).toMatch(/logBackupDownloadAudit/);
    expect(text).toMatch(/streamBackupStampTarGz/);
  });

  it("streams tar.gz with stamp layout and without secrets", async () => {
    const stamp = "2026-07-31T15-30-00-123Z";
    writeClosedStamp(stamp, {
      ".env": "SECRET=1",
      "secrets/credentials.json": '{"k":1}',
      "noise.txt": "skip-me",
    });
    const { dir } = resolveBackupStampDir(stamp);
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve, reject) => {
      sink.on("end", () => resolve());
      sink.on("error", reject);
    });
    const stats = await streamBackupStampTarGz(stamp, dir, sink);
    await done;
    expect(stats.fileCount).toBeGreaterThanOrEqual(4);
    expect(stats.bytesIn).toBeGreaterThan(0);

    const gz = Buffer.concat(chunks);
    const gunzipped = await new Promise<Buffer>((resolve, reject) => {
      const gunzip = createGunzip();
      const out: Buffer[] = [];
      gunzip.on("data", (c: Buffer) => out.push(c));
      gunzip.on("end", () => resolve(Buffer.concat(out)));
      gunzip.on("error", reject);
      gunzip.end(gz);
    });
    const asText = gunzipped.toString("binary");
    expect(asText).toContain(`${stamp}/databases/core.sqlite`);
    expect(asText).toContain(`${stamp}/tenants/t1.sqlite`);
    expect(asText).toContain(
      `${stamp}/timeseries/tenant=platform/analytics.duckdb`
    );
    expect(asText).toContain(`${stamp}/manifest.json`);
    expect(asText).not.toContain(".env");
    expect(asText).not.toContain("credentials.json");
    expect(asText).not.toContain("noise.txt");
  });

  it("resolved path stays under backups root", () => {
    const stamp = "2026-07-31T12-00-00-000Z";
    writeClosedStamp(stamp);
    const { dir } = resolveBackupStampDir(stamp);
    const root = path.resolve(backupsDir);
    const rootSep = root.endsWith(path.sep) ? root : root + path.sep;
    expect(dir === root || dir.startsWith(rootSep)).toBe(true);
  });
});
