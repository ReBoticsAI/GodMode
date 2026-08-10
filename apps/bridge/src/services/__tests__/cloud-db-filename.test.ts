import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLOUD_DB_FILENAME,
  LEGACY_CLOUD_DB_FILENAME,
  ensureCloudDbFilename,
  resolveCloudDbPath,
} from "../data-dir-migration.js";

const temps: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-cloud-db-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ensureCloudDbFilename / resolveCloudDbPath", () => {
  it("renames legacy core.sqlite (+ wal/shm) to Cloud.sqlite", () => {
    const dir = tmpDir();
    const legacy = path.join(dir, LEGACY_CLOUD_DB_FILENAME);
    fs.writeFileSync(legacy, "cloud-bytes");
    fs.writeFileSync(`${legacy}-wal`, "wal");
    fs.writeFileSync(`${legacy}-shm`, "shm");

    ensureCloudDbFilename(dir);

    const cloud = path.join(dir, CLOUD_DB_FILENAME);
    expect(fs.existsSync(cloud)).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(cloud, "utf8")).toBe("cloud-bytes");
    expect(fs.existsSync(`${cloud}-wal`)).toBe(true);
    expect(fs.existsSync(`${cloud}-shm`)).toBe(true);
    expect(resolveCloudDbPath(dir)).toBe(cloud);
  });

  it("prefers Cloud.sqlite when both files exist", () => {
    const dir = tmpDir();
    const cloud = path.join(dir, CLOUD_DB_FILENAME);
    const legacy = path.join(dir, LEGACY_CLOUD_DB_FILENAME);
    fs.writeFileSync(cloud, "new");
    fs.writeFileSync(legacy, "old");

    expect(resolveCloudDbPath(dir)).toBe(cloud);
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it("returns Cloud.sqlite path for fresh installs", () => {
    const dir = tmpDir();
    expect(resolveCloudDbPath(dir)).toBe(path.join(dir, CLOUD_DB_FILENAME));
    expect(fs.existsSync(path.join(dir, CLOUD_DB_FILENAME))).toBe(false);
  });
});
