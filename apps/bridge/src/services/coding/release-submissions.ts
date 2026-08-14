/**
 * Local publisher release submission records for status/metrics (#445).
 * Distinct from Admin Updates consumer poller (`releases` / installation_update_state).
 */
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../../db.js";
import type { GithubReleaseResult } from "./github-release.js";

export type ReleaseSubmissionStatus =
  | "draft"
  | "published"
  | "failed"
  | "staged";

export type ReleaseSubmissionRow = {
  id: string;
  target: string;
  owner: string;
  repo: string;
  tag: string;
  title: string | null;
  status: ReleaseSubmissionStatus;
  github_release_id: number | null;
  html_url: string | null;
  download_count: number;
  metrics_json: string | null;
  staged_payload_json: string | null;
  error: string | null;
  support_ticket_id: string | null;
  task_card_id: string | null;
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export function ensureReleaseSubmissionTables(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS publisher_release_submissions (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL DEFAULT 'github_releases',
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      tag TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      github_release_id INTEGER,
      html_url TEXT,
      download_count INTEGER NOT NULL DEFAULT 0,
      metrics_json TEXT,
      staged_payload_json TEXT,
      error TEXT,
      support_ticket_id TEXT,
      task_card_id TEXT,
      created_by_agent_id TEXT,
      created_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS publisher_release_submissions_by_updated
      ON publisher_release_submissions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS publisher_release_submissions_by_repo
      ON publisher_release_submissions(owner, repo, updated_at DESC);
  `);
}

export function insertReleaseSubmission(
  db: AppDatabase,
  input: {
    target?: string;
    owner: string;
    repo: string;
    tag: string;
    title?: string | null;
    status: ReleaseSubmissionStatus;
    githubReleaseId?: number | null;
    htmlUrl?: string | null;
    downloadCount?: number;
    metrics?: unknown;
    stagedPayload?: unknown;
    error?: string | null;
    supportTicketId?: string | null;
    taskCardId?: string | null;
    agentId?: string | null;
    userId?: string | null;
  }
): ReleaseSubmissionRow {
  ensureReleaseSubmissionTables(db);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO publisher_release_submissions
      (id, target, owner, repo, tag, title, status, github_release_id, html_url,
       download_count, metrics_json, staged_payload_json, error, support_ticket_id,
       task_card_id, created_by_agent_id, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.target ?? "github_releases",
    input.owner,
    input.repo,
    input.tag,
    input.title ?? null,
    input.status,
    input.githubReleaseId ?? null,
    input.htmlUrl ?? null,
    input.downloadCount ?? 0,
    input.metrics != null ? JSON.stringify(input.metrics) : null,
    input.stagedPayload != null ? JSON.stringify(input.stagedPayload) : null,
    input.error ?? null,
    input.supportTicketId ?? null,
    input.taskCardId ?? null,
    input.agentId ?? null,
    input.userId ?? null
  );
  return getReleaseSubmission(db, id)!;
}

export function updateReleaseSubmissionFromGithub(
  db: AppDatabase,
  id: string,
  release: GithubReleaseResult,
  status?: ReleaseSubmissionStatus
): ReleaseSubmissionRow {
  ensureReleaseSubmissionTables(db);
  const nextStatus: ReleaseSubmissionStatus =
    status ?? (release.draft ? "draft" : "published");
  db.prepare(
    `UPDATE publisher_release_submissions SET
      status=?, github_release_id=?, html_url=?, download_count=?,
      metrics_json=?, error=NULL, updated_at=datetime('now')
     WHERE id=?`
  ).run(
    nextStatus,
    release.id,
    release.htmlUrl,
    release.downloadCount,
    JSON.stringify({
      assets: release.assets,
      prerelease: release.prerelease,
      publishedAt: release.publishedAt,
    }),
    id
  );
  return getReleaseSubmission(db, id)!;
}

export function markReleaseSubmissionFailed(
  db: AppDatabase,
  id: string,
  error: string
): ReleaseSubmissionRow {
  ensureReleaseSubmissionTables(db);
  db.prepare(
    `UPDATE publisher_release_submissions SET
      status='failed', error=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(String(error).slice(0, 2000), id);
  return getReleaseSubmission(db, id)!;
}

export function getReleaseSubmission(
  db: AppDatabase,
  id: string
): ReleaseSubmissionRow | null {
  ensureReleaseSubmissionTables(db);
  return (
    (db
      .prepare(`SELECT * FROM publisher_release_submissions WHERE id=?`)
      .get(id) as ReleaseSubmissionRow | undefined) ?? null
  );
}

export function listReleaseSubmissions(
  db: AppDatabase,
  opts?: { limit?: number }
): ReleaseSubmissionRow[] {
  ensureReleaseSubmissionTables(db);
  const limit = Math.min(Math.max(Number(opts?.limit ?? 50), 1), 200);
  return db
    .prepare(
      `SELECT * FROM publisher_release_submissions
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(limit) as ReleaseSubmissionRow[];
}

export function releaseSubmissionMetricsSummary(rows: ReleaseSubmissionRow[]): {
  total: number;
  draft: number;
  published: number;
  failed: number;
  staged: number;
  downloadCount: number;
} {
  const summary = {
    total: rows.length,
    draft: 0,
    published: 0,
    failed: 0,
    staged: 0,
    downloadCount: 0,
  };
  for (const row of rows) {
    if (row.status === "draft") summary.draft += 1;
    else if (row.status === "published") summary.published += 1;
    else if (row.status === "failed") summary.failed += 1;
    else if (row.status === "staged") summary.staged += 1;
    summary.downloadCount += Number(row.download_count ?? 0);
  }
  return summary;
}
