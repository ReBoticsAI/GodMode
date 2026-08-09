#!/usr/bin/env node
/**
 * After Cloud health OK: move GitHub Project items from Waiting Deploy → Done
 * when the issue's merge commit is an ancestor of (or equal to) DEPLOYED_SHA.
 *
 * Exits 1 when GraphQL / scan errors occur (caller job should continue-on-error).
 * Logs a summary; never prints secrets.
 *
 * Env:
 *   DEPLOYED_SHA (required)  full or short commit SHA that is live
 *   GH_TOKEN / GITHUB_TOKEN   token with project write (optional PROJECT_TOKEN)
 *   GODMODE_REPO_DIR         git repo for merge-base (default cwd)
 *   GODMODE_PROJECT_OWNER    default ReBoticsAI
 *   GODMODE_PROJECT_NUMBER   default 1
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const PROJECT_ID = "PVT_kwHODvOEJs4BeDG0";
const STATUS_FIELD_ID = "PVTSSF_lAHODvOEJs4BeDG0zhYgLOE";
const WAITING_DEPLOY = "df73e18b";
const DONE = "98236657";
const OWNER = process.env.GODMODE_PROJECT_OWNER || "ReBoticsAI";
const PROJECT_NUMBER = Number(process.env.GODMODE_PROJECT_NUMBER || "1");
const DEPLOYED_SHA = (process.env.DEPLOYED_SHA || "").trim();
const REPO_DIR = process.env.GODMODE_REPO_DIR || process.cwd();
const TOKEN =
  process.env.PROJECT_TOKEN ||
  process.env.GH_TOKEN ||
  process.env.GITHUB_TOKEN ||
  "";

function log(msg) {
  console.log(`[waiting-deploy-done] ${msg}`);
}

async function ghGraphql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "User-Agent": "godmode-waiting-deploy-done",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors?.length) {
    throw new Error(
      `GraphQL failed: ${JSON.stringify(json.errors || { status: res.status })}`
    );
  }
  return json.data;
}

function isAncestor(candidate, tip) {
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", candidate, tip],
      { cwd: REPO_DIR, stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

function prLinksIssue(pr, issueNumber) {
  const n = Number(issueNumber);
  if ((pr.closingIssuesReferences || []).some((r) => Number(r.number) === n)) {
    return true;
  }
  const needle = `#${issueNumber}`;
  const title = typeof pr.title === "string" ? pr.title : "";
  const body = typeof pr.body === "string" ? pr.body : "";
  if (title.includes(needle)) return true;
  // Core ship loop uses Part of #N (not Closes) so ancestry can resolve.
  if (body.includes(needle)) return true;
  return false;
}

function resolveMergeSha(issueNumber) {
  try {
    const out = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        `${OWNER}/GodMode`,
        "--state",
        "merged",
        "--search",
        `${issueNumber}`,
        "--json",
        "number,mergeCommit,closingIssuesReferences,title,body",
        "--limit",
        "20",
      ],
      { encoding: "utf8" }
    );
    const prs = JSON.parse(out);
    for (const pr of prs) {
      if (!prLinksIssue(pr, issueNumber)) continue;
      const sha = pr.mergeCommit?.oid;
      if (sha) return sha;
    }
  } catch (err) {
    log(`pr lookup failed for #${issueNumber}: ${(err && err.message) || err}`);
  }
  return null;
}

async function setDone(itemId) {
  await ghGraphql(
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }`,
    {
      projectId: PROJECT_ID,
      itemId,
      fieldId: STATUS_FIELD_ID,
      optionId: DONE,
    }
  );
}

async function main() {
  if (!DEPLOYED_SHA) {
    log("DEPLOYED_SHA missing; skip board move");
    return;
  }
  if (!TOKEN) {
    log("No GitHub token; skip board move");
    return;
  }
  if (!existsSync(REPO_DIR)) {
    log(`Repo dir missing (${REPO_DIR}); skip ancestry checks`);
  }

  let moved = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Prefer gh project item-list for Waiting Deploy rows
    const listRaw = execFileSync(
      "gh",
      [
        "project",
        "item-list",
        String(PROJECT_NUMBER),
        "--owner",
        OWNER,
        "--format",
        "json",
        "--limit",
        "200",
      ],
      { encoding: "utf8" }
    );
    const parsed = JSON.parse(listRaw);
    const items = parsed.items || parsed;
    const waiting = items.filter((i) => i.status === "Waiting Deploy");
    log(`Waiting Deploy count=${waiting.length}; deployed=${DEPLOYED_SHA.slice(0, 12)}`);

    for (const item of waiting) {
      const number = item.content?.number;
      const itemId = item.id;
      if (!number || !itemId) {
        skipped += 1;
        continue;
      }
      const mergeSha = resolveMergeSha(number);
      if (!mergeSha) {
        log(`#${number}: no merged PR SHA; leave Waiting Deploy`);
        skipped += 1;
        continue;
      }
      const contained =
        mergeSha === DEPLOYED_SHA ||
        mergeSha.startsWith(DEPLOYED_SHA) ||
        DEPLOYED_SHA.startsWith(mergeSha) ||
        isAncestor(mergeSha, DEPLOYED_SHA);
      if (!contained) {
        log(`#${number}: merge ${mergeSha.slice(0, 12)} not in deploy tip; leave`);
        skipped += 1;
        continue;
      }
      try {
        await setDone(itemId);
        moved += 1;
        log(`#${number}: moved to Done`);
      } catch (err) {
        errors += 1;
        log(`#${number}: move failed: ${(err && err.message) || err}`);
      }
    }
  } catch (err) {
    errors += 1;
    log(`board scan failed: ${(err && err.message) || err}`);
  }

  log(`summary moved=${moved} skipped=${skipped} errors=${errors}`);
  // Non-zero on errors so the GitHub-hosted job shows red; workflow uses continue-on-error.
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  log(`fatal: ${(err && err.message) || err}`);
  process.exit(1);
});
