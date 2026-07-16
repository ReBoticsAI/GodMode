import type { ObjectTypeDef, RecordRow } from "@godmode/kernel";
import type {
  OperationContext,
  RecordAdapter,
  RecordQuery,
} from "../adapter-registry.js";
import {
  checkForUpdates,
  configureUpdates,
  createCoordinatedSnapshot,
  downloadRelease,
  mutateUpdateState,
  pluginCompatibility,
  readinessDiagnostics,
  requestSupervisorAction,
  selectReleaseArtifact,
  type ReleaseManifest,
} from "../../services/release-flow.js";

function requireAdmin(ctx: OperationContext): void {
  if (ctx.source === "system") return;
  if (!ctx.userId) throw Object.assign(new Error("Authenticated user required"), { status: 401 });
  if (!ctx.isAdmin) {
    throw Object.assign(new Error("Platform administrator required"), { status: 403 });
  }
}

function row(def: ObjectTypeDef, value: Record<string, unknown>): RecordRow {
  return {
    id: String(value.id),
    objectType: def.name,
    data: value,
  };
}

function updateStateValue(db: Parameters<NonNullable<RecordAdapter["list"]>>[0]) {
  const value = db
    .prepare("SELECT * FROM installation_update_state WHERE id='installation'")
    .get() as Record<string, unknown>;
  const release =
    typeof value.available_release_id === "string"
      ? (db
          .prepare(
            "SELECT version, manifest_json FROM releases WHERE id=?"
          )
          .get(value.available_release_id) as
          | { version: string; manifest_json: string }
          | undefined)
      : undefined;
  let manifest: ReleaseManifest | null = null;
  try {
    manifest = release
      ? (JSON.parse(release.manifest_json) as ReleaseManifest)
      : null;
  } catch {
    manifest = null;
  }
  const artifact = selectReleaseArtifact(manifest?.artifacts as Array<Record<string, unknown>> | undefined);
  const compatibility = manifest ? pluginCompatibility(manifest) : [];
  const supervisor = process.env.UPDATE_SUPERVISOR_URL ?? "";
  let localSupervisor = false;
  try {
    const host = new URL(supervisor).hostname;
    localSupervisor =
      ["127.0.0.1", "::1", "localhost", "host.docker.internal"].includes(host) &&
      Boolean(process.env.UPDATE_SUPERVISOR_TOKEN);
  } catch {
    localSupervisor = false;
  }
  const backup = db
    .prepare(
      `SELECT status FROM release_snapshots
       WHERE release_id IS ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(value.available_release_id ?? null) as { status?: string } | undefined;
  const surface = process.env.INSTALLATION_SURFACE ?? "developer_source";
  return {
    ...value,
    target_version: release?.version ?? null,
    release_notes: manifest?.releaseNotes?.summary ?? null,
    release_notes_url: manifest?.releaseNotes?.url ?? null,
    download_size: typeof artifact?.size === "number" ? artifact.size : null,
    compatibility_status:
      compatibility.every((item) => item.compatible) ? "compatible" : "blocked",
    update_available: Boolean(release),
    installation_surface: surface,
    backup_status: backup?.status ?? "not_created",
    can_apply: localSupervisor,
    apply_hint: localSupervisor
      ? null
      : surface === "electron"
        ? "Restart GodMode after installing the signed desktop update, or reinstall from the verified GitHub release."
        : "Run the signed host-side godmode-update command from docs/RELEASES.md.",
    image_digest:
      manifest?.image && typeof manifest.image.digest === "string"
        ? manifest.image.digest
        : null,
  };
}

function paging(query: RecordQuery): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(Number(query.limit) || 100, 1), 500),
    offset: Math.max(Number(query.offset) || 0, 0),
  };
}

export const releaseAdapter: RecordAdapter = {
  id: "release_service",
  policy: {
    authorize(_operation, _def, ctx) {
      requireAdmin(ctx);
      return true;
    },
  },
  list(db, def, query, ctx) {
    requireAdmin(ctx);
    const { limit, offset } = paging(query);
    const total = (db.prepare("SELECT COUNT(*) AS count FROM releases").get() as {
      count: number;
    }).count;
    const values = db
      .prepare(
        `SELECT id, version, channel, published_at, discovered_at
         FROM releases ORDER BY published_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Array<Record<string, unknown>>;
    return { objectType: def.name, records: values.map((value) => row(def, value)), total };
  },
  get(db, def, id, ctx) {
    requireAdmin(ctx);
    const value = db
      .prepare(
        `SELECT id, version, channel, published_at, discovered_at
         FROM releases WHERE id=?`
      )
      .get(id) as Record<string, unknown> | undefined;
    return value ? row(def, value) : null;
  },
  actions: {
    preflight(db, _def, id, _input, ctx) {
      requireAdmin(ctx);
      const diagnostics = readinessDiagnostics(db, id);
      return {
        ready: diagnostics.every((item) => !item.blocking || item.ok),
        diagnostics,
      };
    },
    compatibility(db, _def, id, _input, ctx) {
      requireAdmin(ctx);
      const value = db.prepare("SELECT manifest_json FROM releases WHERE id=?").get(id) as
        | { manifest_json: string }
        | undefined;
      if (!value) throw Object.assign(new Error("Release not found"), { status: 404 });
      return {
        plugins: pluginCompatibility(
          JSON.parse(value.manifest_json) as ReleaseManifest
        ),
      };
    },
  },
};

export const installationUpdateStateAdapter: RecordAdapter = {
  id: "installation_update_state_service",
  policy: {
    authorize(_operation, _def, ctx) {
      requireAdmin(ctx);
      return true;
    },
  },
  list(db, def, _query, ctx) {
    requireAdmin(ctx);
    const value = updateStateValue(db);
    return { objectType: def.name, records: [row(def, value)], total: 1 };
  },
  get(db, def, id, ctx) {
    requireAdmin(ctx);
    if (id !== "installation") return null;
    return row(def, updateStateValue(db));
  },
  actions: {
    check_now(db, _def, _id, _input, ctx) {
      requireAdmin(ctx);
      return checkForUpdates(db, { actorId: ctx.userId ?? ctx.agentId });
    },
    download(db, _def, _id, input, ctx) {
      requireAdmin(ctx);
      const current = db
        .prepare(
          "SELECT available_release_id FROM installation_update_state WHERE id='installation'"
        )
        .get() as { available_release_id: string | null };
      const releaseId =
        typeof input.release_id === "string"
          ? input.release_id
          : current.available_release_id;
      if (!releaseId) throw new Error("No available release to download");
      return downloadRelease(db, releaseId, ctx.userId ?? ctx.agentId);
    },
    defer(db, _def, _id, input, ctx) {
      requireAdmin(ctx);
      return mutateUpdateState(db, "defer", input, ctx.userId ?? ctx.agentId);
    },
    skip_release(db, _def, _id, input, ctx) {
      requireAdmin(ctx);
      return mutateUpdateState(db, "skip_release", input, ctx.userId ?? ctx.agentId);
    },
    configure(db, _def, _id, input, ctx) {
      requireAdmin(ctx);
      return configureUpdates(db, input, ctx.userId ?? ctx.agentId);
    },
    preflight(db, _def, _id, input, ctx) {
      requireAdmin(ctx);
      const releaseId =
        typeof input.release_id === "string" ? input.release_id : null;
      const diagnostics = readinessDiagnostics(db, releaseId);
      return {
        ready: diagnostics.every((item) => !item.blocking || item.ok),
        diagnostics,
      };
    },
    create_snapshot(db, _def, _id, input, ctx) {
      requireAdmin(ctx);
      const current = db
        .prepare(
          "SELECT available_release_id FROM installation_update_state WHERE id='installation'"
        )
        .get() as { available_release_id: string | null };
      return createCoordinatedSnapshot(
        db,
        typeof input.release_id === "string"
          ? input.release_id
          : current.available_release_id,
        ctx.userId ?? ctx.agentId
      );
    },
    async apply(db, _def, _id, _input, ctx) {
      requireAdmin(ctx);
      return requestSupervisorAction(db, "apply", ctx.userId ?? ctx.agentId);
    },
    async restart_to_apply(db, _def, _id, _input, ctx) {
      requireAdmin(ctx);
      return requestSupervisorAction(
        db,
        "restart_to_apply",
        ctx.userId ?? ctx.agentId
      );
    },
  },
};

export const releaseAdapters = [
  releaseAdapter,
  installationUpdateStateAdapter,
] as const;
