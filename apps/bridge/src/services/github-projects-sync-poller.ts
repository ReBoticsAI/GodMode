/**
 * Background poll: GitHub → GodMode for linked Tasks boards.
 * Primary near-real-time path for user-owned Projects (GitHub does not emit
 * projects_v2_item for personal boards). Org-owned Projects also get App webhooks.
 */
import { getCloudDb, listAllTenantIds } from "../core-db.js";
import { config } from "../config.js";
import { getTenantDb } from "../tenant-registry.js";
import {
  GITHUB_SYNC_LEASE_MS,
  listGithubSyncedBoards,
  syncBoardWithGithub,
} from "./github-projects.js";

const DEFAULT_POLL_MS = 60_000;
const MIN_POLL_MS = 60_000;
const MAX_POLL_MS = 30 * 60 * 1000;

function pollIntervalMs(): number {
  const raw = Number(config.githubProjectsSync.pollIntervalMs);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.floor(raw)));
}

function boardBusy(syncStartedAt: string | null, nowMs = Date.now()): boolean {
  if (!syncStartedAt) return false;
  const started = Date.parse(syncStartedAt);
  if (!Number.isFinite(started)) return true;
  return nowMs - started < GITHUB_SYNC_LEASE_MS;
}

export class GithubProjectsSyncPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  start(): void {
    if (!config.githubProjectsSync.pollEnabled) {
      console.info("[github-projects-sync] poller disabled");
      return;
    }
    if (this.timer) return;
    this.schedule(true);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(immediate = false): void {
    const base = pollIntervalMs();
    const jitter = Math.floor(Math.random() * Math.min(30_000, base / 4));
    const delay = immediate ? 15_000 + jitter : base + jitter;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick().finally(() => this.schedule(false));
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const core = getCloudDb();
      for (const tenantId of listAllTenantIds(core)) {
        let db;
        try {
          db = getTenantDb(tenantId);
        } catch {
          continue;
        }
        let boards: ReturnType<typeof listGithubSyncedBoards> = [];
        try {
          boards = listGithubSyncedBoards(db);
        } catch {
          continue;
        }
        for (const board of boards) {
          if (!board.user_id || boardBusy(board.sync_started_at)) continue;
          try {
            const result = await syncBoardWithGithub({
              userId: board.user_id,
              db,
              boardId: board.id,
              skipIfBusy: true,
            });
            if (!result.skipped) {
              console.info(
                `[github-projects-sync] tenant=${tenantId} board=${board.id} pulled=${result.pulled}`
              );
            }
          } catch (err) {
            console.warn(
              `[github-projects-sync] tenant=${tenantId} board=${board.id}:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const githubProjectsSyncPoller = new GithubProjectsSyncPoller();
