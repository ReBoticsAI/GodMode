import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import {
  insertReleaseSubmission,
  listReleaseSubmissions,
  releaseSubmissionMetricsSummary,
  updateReleaseSubmissionFromGithub,
} from "../coding/release-submissions.js";

function openDb(): AppDatabase {
  return new Database(":memory:") as unknown as AppDatabase;
}

describe("release-submissions", () => {
  it("persists rows and summarizes metrics", () => {
    const db = openDb();
    const a = insertReleaseSubmission(db, {
      owner: "o",
      repo: "r",
      tag: "v1",
      title: "One",
      status: "draft",
      downloadCount: 2,
    });
    insertReleaseSubmission(db, {
      owner: "o",
      repo: "r",
      tag: "v2",
      status: "published",
      downloadCount: 5,
    });
    const updated = updateReleaseSubmissionFromGithub(db, a.id, {
      id: 99,
      tag: "v1",
      name: "One",
      draft: false,
      prerelease: false,
      htmlUrl: "https://github.com/o/r/releases/tag/v1",
      uploadUrl: "",
      publishedAt: "2026-01-01T00:00:00Z",
      downloadCount: 7,
      assets: [{ name: "a.zip", downloadCount: 7, size: 10 }],
    });
    expect(updated.status).toBe("published");
    expect(updated.github_release_id).toBe(99);
    expect(updated.download_count).toBe(7);

    const rows = listReleaseSubmissions(db);
    expect(rows).toHaveLength(2);
    const metrics = releaseSubmissionMetricsSummary(rows);
    expect(metrics.total).toBe(2);
    expect(metrics.published).toBe(2);
    expect(metrics.downloadCount).toBe(12);
  });
});
