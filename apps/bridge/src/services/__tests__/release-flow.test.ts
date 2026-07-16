import {
  generateKeyPairSync,
  sign,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkForUpdates,
  createCoordinatedSnapshot,
  ensureReleaseTables,
  pluginCompatibility,
  reconcileInstalledVersion,
  selectRelease,
  validateSigstoreManifest,
  validateSignedManifest,
  type ReleaseManifest,
} from "../release-flow.js";
import { config } from "../../config.js";
import { installationUpdateStateAdapter } from "../../kernel/adapters/release.js";
import { evictTenantDb, getTenantDb } from "../../tenant-registry.js";
import type { ObjectTypeDef } from "@godmode/kernel";
import {
  ensureOperationRunTables,
  OperationRunWorker,
} from "../../kernel/operation-run-worker.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function signedManifest(overrides: Partial<ReleaseManifest> = {}) {
  const keys = generateKeyPairSync("ed25519");
  const commit = "a".repeat(40);
  const digest = "a".repeat(64);
  const unsigned = {
    version: "1.2.0",
    channel: "stable",
    publishedAt: "2026-07-15T00:00:00.000Z",
    artifact: {
      url: "https://updates.example/godmode.bin",
      sha256: digest,
    },
    schema: "https://godmode.dev/schemas/release-manifest-v1.json",
    commit,
    releaseNotes: {
      url: "https://github.com/ReBoticsAI/GodMode/releases/tag/v1.2.0",
      summary: "Test release",
    },
    compatibility: {
      engine: { minimum: "1.0.0", maximum: "1.2.0" },
      kernelClientApi: { minimum: 1, maximum: 1 },
      schema: { minimum: 0, maximum: 1, rollbackMinimum: 0 },
      connectors: {},
    },
    policy: { mandatory: false, security: false },
    signing: {
      method: "sigstore-keyless",
      issuer: "https://token.actions.githubusercontent.com",
      identity:
        "https://github.com/ReBoticsAI/GodMode/.github/workflows/release.yml@refs/heads/main",
      bundle: "release-manifest.json.bundle",
    },
    image: {
      repository: "ghcr.io/reboticsai/godmode",
      tag: "1.2.0",
      digest: `sha256:${digest}`,
      commit,
      platforms: ["linux/amd64", "linux/arm64"],
    },
    artifacts: [
      {
        name: "godmode-v1.2.0-linux-x64.tar.gz",
        kind: "bundle",
        platform: "linux-x64",
        version: "1.2.0",
        commit,
        sha256: digest,
        size: 10,
      },
      {
        name: "godmode-v1.2.0-windows-x64.zip",
        kind: "bundle",
        platform: "windows-x64",
        version: "1.2.0",
        commit,
        sha256: digest,
        size: 10,
      },
    ],
    pluginConstraints: {},
    ...overrides,
  };
  const signature = sign(
    null,
    Buffer.from(stableJson(unsigned)),
    keys.privateKey
  ).toString("base64");
  return {
    manifest: { ...unsigned, signature } as ReleaseManifest,
    publicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

function coreDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, is_admin INTEGER NOT NULL);
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, recipient_kind TEXT NOT NULL, recipient_id TEXT NOT NULL,
      recipient_tenant_id TEXT, category TEXT, title TEXT NOT NULL, body TEXT,
      link TEXT, resource_kind TEXT, resource_id TEXT, read_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  ensureReleaseTables(db);
  db.prepare("INSERT INTO users (id, is_admin) VALUES ('admin-a', 1)").run();
  db.prepare(
    "UPDATE installation_update_state SET current_version='1.0.0', manifest_url='https://updates.example/manifest.json'"
  ).run();
  return db;
}

afterEach(() => {
  delete process.env.UPDATE_MANIFEST_PUBLIC_KEY;
  delete process.env.UPDATE_SNAPSHOT_DIR;
});

describe("release flow", () => {
  it("rejects unsigned, malformed, and incorrectly signed manifests", () => {
    const { manifest, publicKey } = signedManifest();
    expect(() =>
      validateSignedManifest({ ...manifest, signature: "" }, publicKey)
    ).toThrow(/schema/i);
    expect(() =>
      validateSignedManifest({ ...manifest, version: "1.2.1" }, publicKey)
    ).toThrow(/signature/i);
    expect(() =>
      validateSignedManifest(manifest, "")
    ).toThrow(/public key/i);
  });

  it("pins Sigstore verification to the GodMode release workflow", async () => {
    const manifest = signedManifest().manifest;
    const payload = JSON.stringify(manifest);
    let verified = false;
    await expect(
      validateSigstoreManifest(
        payload,
        {} as never,
        (async (_bundle, bytes, options) => {
          verified = true;
          expect(bytes.toString()).toBe(payload);
          expect(options.certificateIssuer).toBe(
            "https://token.actions.githubusercontent.com"
          );
          expect(options.certificateIdentityURI).toMatch(/release/);
          return {};
        }) as never
      )
    ).resolves.toMatchObject({ version: "1.2.0", signature: "sigstore-keyless" });
    expect(verified).toBe(true);

    const malicious = {
      ...manifest,
      signing: {
        ...manifest.signing,
        identity:
          "https://github.com/attacker/repo/.github/workflows/release.yml@refs/heads/main",
      },
    };
    await expect(
      validateSigstoreManifest(JSON.stringify(malicious), {} as never, (async () => ({})) as never)
    ).rejects.toThrow(/schema/i);
  });

  it("selects the newest eligible release for the configured channel", () => {
    const stable = signedManifest({ version: "1.1.0", channel: "stable" }).manifest;
    const nightly = signedManifest({ version: "1.4.0-nightly.1", channel: "nightly" }).manifest;
    expect(selectRelease([stable, nightly], "stable", "1.0.0")?.version).toBe("1.1.0");
    expect(selectRelease([stable, nightly], "nightly", "1.0.0")?.version).toBe("1.4.0-nightly.1");
    expect(selectRelease([stable], "stable", "1.0.0", "1.1.0")).toBeNull();
  });

  it("deduplicates admin notifications for repeated signed manifests", async () => {
    const db = coreDb();
    const { manifest, publicKey } = signedManifest();
    process.env.UPDATE_MANIFEST_PUBLIC_KEY = publicKey;
    const fetchImpl = async (input: string | URL | Request) =>
      String(input).endsWith(".bundle")
        ? new Response(JSON.stringify({ mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" }))
        : new Response(JSON.stringify(manifest), {
            status: 200,
            headers: { "content-type": "application/json", etag: '"release-1.2.0"' },
          });
    const verifyImpl = async () => ({});
    const first = await checkForUpdates(db, {
      fetchImpl: fetchImpl as typeof fetch,
      verifyImpl: verifyImpl as never,
    });
    const second = await checkForUpdates(db, {
      fetchImpl: fetchImpl as typeof fetch,
      verifyImpl: verifyImpl as never,
    });
    expect(first.notifications).toBe(1);
    expect(second.notifications).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM notifications").get() as { count: number }).count
    ).toBe(1);
  });

  it("enforces admin access and preserves singleton update state", () => {
    const db = coreDb();
    const def: ObjectTypeDef = {
      name: "InstallationUpdateState",
      label: "Installation Update State",
      storage: { kind: "adapter", adapterId: installationUpdateStateAdapter.id },
      fields: [{ name: "id", label: "ID", fieldType: "Data" }],
      operations: ["list", "get"],
    };
    const base = {
      tenantId: "tenant-a",
      userId: "user-a",
      role: "owner" as const,
      source: "http" as const,
      data: { coreDb: db, tenantDb: db, declaredDatabase: "core" as const },
    };
    expect(() =>
      installationUpdateStateAdapter.list!(db, def, {}, { ...base, isAdmin: false })
    ).toThrow(/administrator/i);
    expect(
      installationUpdateStateAdapter.list!(db, def, {}, { ...base, isAdmin: true })
    ).toMatchObject({ total: 1 });
    expect(
      installationUpdateStateAdapter.get!(db, def, "other", { ...base, isAdmin: true })
    ).toBeNull();
  });

  it("records an externally applied version when the bridge restarts", () => {
    const db = coreDb();
    expect(reconcileInstalledVersion(db, "1.2.0")).toBe(true);
    expect(reconcileInstalledVersion(db, "1.2.0")).toBe(false);
    expect(
      (db.prepare(
        "SELECT current_version, status FROM installation_update_state WHERE id='installation'"
      ).get() as { current_version: string; status: string })
    ).toEqual({ current_version: "1.2.0", status: "idle" });
    expect(
      (db.prepare(
        "SELECT COUNT(*) AS count FROM installation_update_history WHERE action='version_observed'"
      ).get() as { count: number }).count
    ).toBe(1);
  });

  it("records rollback evidence when a host restore is observed", () => {
    const db = coreDb();
    expect(reconcileInstalledVersion(db, "1.2.0")).toBe(true);
    db.prepare(
      `INSERT INTO release_application_attempts
        (id, release_id, snapshot_id, action, status, actor_id)
       VALUES ('attempt-1', 'rel-1', 'snap-1', 'apply', 'accepted', 'admin')`
    ).run();
    expect(reconcileInstalledVersion(db, "1.1.0")).toBe(true);
    expect(
      (db.prepare(
        "SELECT status FROM release_application_attempts WHERE id='attempt-1'"
      ).get() as { status: string }).status
    ).toBe("rolled_back");
    expect(
      (db.prepare(
        "SELECT restored, prior_version FROM release_rollback_evidence WHERE attempt_id='attempt-1'"
      ).get() as { restored: number; prior_version: string })
    ).toEqual({ restored: 1, prior_version: "1.2.0" });
  });

  it("reports plugin compatibility against release locks", () => {
    const manifest = signedManifest({
      plugins: { compatible: "^1.2.0", blocked: ">=2.0.0" },
    }).manifest;
    expect(
      pluginCompatibility(manifest, [
        { id: "compatible", name: "Compatible", version: "1.3.0" },
        { id: "blocked", name: "Blocked", version: "1.9.0" },
        {
          id: "executable",
          name: "Executable",
          version: "1.0.0",
          engine: "^1.2.0",
          bridge: { entry: "dist/bridge.js" },
        },
        {
          id: "undeclared",
          name: "Undeclared",
          version: "1.0.0",
          web: { entry: "dist/web.js" },
        },
      ])
    ).toEqual([
      { id: "compatible", version: "1.3.0", required: "^1.2.0", compatible: true },
      { id: "blocked", version: "1.9.0", required: ">=2.0.0", compatible: false },
      { id: "executable", version: "1.0.0", required: "^1.2.0", compatible: true },
      { id: "undeclared", version: "1.0.0", required: null, compatible: false },
    ]);
  });

  it("processes durable operation runs stored in the core database", async () => {
    const db = new Database(":memory:");
    ensureOperationRunTables(db);
    db.prepare(
      `INSERT INTO kernel_operation_runs
        (id, tenant_id, actor_id, object_type, action_name, status)
       VALUES ('core-run', NULL, 'system', 'InstallationUpdateState',
               'check_now', 'pending')`
    ).run();
    const seen: string[] = [];
    const worker = new OperationRunWorker(
      () => [{ tenantId: "core", db }],
      async (_database, run) => {
        seen.push(run.id);
        db.prepare(
          `UPDATE kernel_operation_runs SET status='succeeded',
           finished_at=datetime('now') WHERE id=?`
        ).run(run.id);
      }
    );
    expect(await worker.drainOnce()).toBe(1);
    expect(seen).toEqual(["core-run"]);
    expect(
      (db.prepare("SELECT status FROM kernel_operation_runs WHERE id='core-run'").get() as {
        status: string;
      }).status
    ).toBe("succeeded");
  });

  it("creates and verifies a coordinated external core snapshot with a plugin lock", async () => {
    const db = coreDb();
    db.exec(`
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY, is_operator INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE tenant_plugins (
        tenant_id TEXT NOT NULL, plugin_id TEXT NOT NULL, version TEXT NOT NULL,
        state TEXT NOT NULL, desired_state TEXT NOT NULL
      );
    `);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "godmode-release-"));
    const previousWorkspaces = config.tenantWorkspacesDir;
    const previousTenants = config.tenantsDir;
    process.env.UPDATE_SNAPSHOT_DIR = path.join(temporary, "snapshots");
    config.tenantWorkspacesDir = path.join(temporary, "tenant-workspaces");
    config.tenantsDir = path.join(temporary, "tenants");
    fs.mkdirSync(path.join(config.tenantWorkspacesDir, "tenant-a"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(config.tenantWorkspacesDir, "tenant-a", "workspace.txt"),
      "tenant workspace"
    );
    db.prepare(
      "INSERT INTO tenants (id, is_operator) VALUES ('tenant-a', 0)"
    ).run();
    db.prepare(
      `INSERT INTO tenant_plugins
       (tenant_id, plugin_id, version, state, desired_state)
       VALUES ('tenant-a', 'plugin-a', '1.0.0', 'active', 'active')`
    ).run();
    const tenantDb = getTenantDb("tenant-a");
    tenantDb.exec(
      "CREATE TABLE release_test (id TEXT PRIMARY KEY); INSERT INTO release_test VALUES ('record-a')"
    );
    try {
      const snapshot = await createCoordinatedSnapshot(db, null, "admin-a");
      expect(fs.existsSync(path.join(snapshot.location, "databases", "core.sqlite"))).toBe(true);
      expect(
        fs.existsSync(
          path.join(snapshot.location, "databases", "tenant-a.sqlite")
        )
      ).toBe(true);
      expect(
        fs.readFileSync(
          path.join(
            snapshot.location,
            "tenant-workspaces",
            "tenant-a",
            "workspace.txt"
          ),
          "utf8"
        )
      ).toBe("tenant workspace");
      expect(fs.existsSync(path.join(snapshot.location, "plugin-lock.json"))).toBe(true);
      expect(
        fs.existsSync(path.join(snapshot.location, "snapshot-manifest.json"))
      ).toBe(true);
      expect(snapshot.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(snapshot.lock).toMatchObject({
        tenantPlugins: expect.arrayContaining([
          expect.objectContaining({
            tenant_id: "tenant-a",
            plugin_id: "plugin-a",
            version: "1.0.0",
          }),
        ]),
      });
      expect(
        (db.prepare("SELECT status FROM release_snapshots WHERE id=?").get(snapshot.id) as {
          status: string;
        }).status
      ).toBe("ready");
    } finally {
      evictTenantDb("tenant-a");
      config.tenantWorkspacesDir = previousWorkspaces;
      config.tenantsDir = previousTenants;
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
});
