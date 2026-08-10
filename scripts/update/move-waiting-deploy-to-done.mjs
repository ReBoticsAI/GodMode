#!/usr/bin/env node
/**
 * After Cloud health OK: move GitHub Project items from Waiting Deploy → Done
 * when the issue's merge commit is an ancestor of (or equal to) DEPLOYED_SHA.
 *
 * Exits 1 when GraphQL / scan errors occur, or when PROJECT_TOKEN is missing
 * (caller job should continue-on-error so deploy stays green).
 * Logs a summary; never prints secrets.
 *
 * Env:
 *   DEPLOYED_SHA (required)  full or short commit SHA that is live
 *   PROJECT_TOKEN (required) PAT with project read/write on the user project
 *   GH_TOKEN / GITHUB_TOKEN   fallback only for local dry-runs (often cannot
 *                            list/write user projects from Actions)
 *   GODMODE_REPO_DIR         git repo for merge-base (default cwd)
 *   GODMODE_PROJECT_OWNER    default ReBoticsAI
 *   GODMODE_PROJECT_NUMBER   default 1
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const PROJECT_ID = "PVT_kwHODvOEJs4BeDG0";
const STATUS_FIELD_ID = "PVTSSF_lAHODvOEJs4BeDG0zhYgLOE";
const DONE = "98236657";
const OWNER = process.env.GODMODE_PROJECT_OWNER || "ReBoticsAI";
const PROJECT_NUMBER = Number(process.env.GODMODE_PROJECT_NUMBER || "1");
const DEPLOYED_SHA = (process.env.DEPLOYED_SHA || "").trim();
const REPO_DIR = process.env.GODMODE_REPO_DIR || process.cwd();
const HAS_PROJECT_TOKEN = Boolean(process.env.PROJECT_TOKEN?.trim());
const TOKEN =
  process.env.PROJECT_TOKEN?.trim() ||
  process.env.GH_TOKEN?.trim() ||
  process.env.GITHUB_TOKEN?.trim() ||
  "";

function log(msg) {
  console.log(`[waiting-deploy-done] ${msg}`);
}

function ghEnv() {
  // Prefer PROJECT_TOKEN for both `gh` CLI and GraphQL (user project access).
  const env = { ...process.env };
  if (TOKEN) env.GH_TOKEN = TOKEN;
  if (TOKEN) env.GITHUB_TOKEN = TOKEN;
  return env;
}

function runGh(args, options = {}) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    cwd: REPO_DIR,
    env: ghEnv(),
    ...options,
  });
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

function containedInDeploy(mergeSha) {
  if (!mergeSha) return false;
  if (
    mergeSha === DEPLOYED_SHA ||
    mergeSha.startsWith(DEPLOYED_SHA) ||
    DEPLOYED_SHA.startsWith(mergeSha)
  ) {
    return true;
  }
  return isAncestor(mergeSha, DEPLOYED_SHA);
}

/** Prefer merge commits still on the deploy tip (survives history rewrites). */
function resolveMergeShaFromGit(issueNumber) {
  try {
    const out = execFileSync(
      "git",
      [
        "log",
        DEPLOYED_SHA,
        "--merges",
        `--grep=Merge pull request #${issueNumber} `,
        "-n",
        "1",
        "--format=%H",
      ],
      { cwd: REPO_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (out) return out;
  } catch {
    /* fall through */
  }
  try {
    // Squash / non-merge landings that mention the issue in the subject.
    const out = execFileSync(
      "git",
      [
        "log",
        DEPLOYED_SHA,
        `--grep=#${issueNumber}`,
        "-n",
        "5",
        "--format=%H %s",
      ],
      { cwd: REPO_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    for (const line of out.split("\n").filter(Boolean)) {
      const sha = line.slice(0, 40);
      const subject = line.slice(41);
      if (
        subject.includes(`(#${issueNumber})`) ||
        subject.includes(`#${issueNumber}`)
      ) {
        return sha;
      }
    }
  } catch {
    /* fall through */
  }
  return null;
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
  if (body.includes(needle)) return true;
  return false;
}

function resolveMergeShaFromGh(issueNumber) {
  try {
    const out = runGh([
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
    ]);
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

function resolveMergeSha(issueNumber) {
  return (
    resolveMergeShaFromGit(issueNumber) || resolveMergeShaFromGh(issueNumber)
  );
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

/**
 * List Waiting Deploy items via Projects filter (avoids truncated unfiltered pages).
 * Falls back to GraphQL pagination if the CLI query returns nothing usable.
 */
function listWaitingDeployViaCli() {
  const listRaw = runGh([
    "project",
    "item-list",
    String(PROJECT_NUMBER),
    "--owner",
    OWNER,
    "--format",
    "json",
    "--limit",
    "100",
    "--query",
    'status:"Waiting Deploy"',
  ]);
  const parsed = JSON.parse(listRaw);
  const items = parsed.items || parsed;
  if (!Array.isArray(items)) {
    throw new Error("gh project item-list returned unexpected JSON");
  }
  return items
    .filter((i) => !i.status || i.status === "Waiting Deploy")
    .map((i) => ({
      id: i.id,
      number: i.content?.number,
      title: i.content?.title || i.title || "",
    }))
    .filter((i) => i.id && i.number);
}

async function listWaitingDeployViaGraphql() {
  const waiting = [];
  let cursor = null;
  let hasNext = true;
  while (hasNext) {
    const data = await ghGraphql(
      `query($owner: String!, $number: Int!, $after: String) {
        user(login: $owner) {
          projectV2(number: $number) {
            items(first: 50, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                  }
                }
                content {
                  ... on Issue { number title }
                }
              }
            }
          }
        }
      }`,
      { owner: OWNER, number: PROJECT_NUMBER, after: cursor }
    );
    const conn = data?.user?.projectV2?.items;
    if (!conn) {
      throw new Error("GraphQL project items missing (token may lack project scope)");
    }
    for (const node of conn.nodes || []) {
      const status = (node.fieldValues?.nodes || []).find(
        (f) => f.field?.name === "Status" && f.name
      )?.name;
      if (status !== "Waiting Deploy") continue;
      const number = node.content?.number;
      if (!number || !node.id) continue;
      waiting.push({
        id: node.id,
        number,
        title: node.content?.title || "",
      });
    }
    hasNext = Boolean(conn.pageInfo?.hasNextPage);
    cursor = conn.pageInfo?.endCursor || null;
  }
  return waiting;
}

async function listWaitingDeploy() {
  try {
    const viaCli = listWaitingDeployViaCli();
    if (viaCli.length > 0) return { items: viaCli, source: "cli-query" };
    log("CLI status query returned 0; trying GraphQL pagination");
  } catch (err) {
    log(`CLI list failed: ${(err && err.message) || err}; trying GraphQL`);
  }
  const viaGql = await listWaitingDeployViaGraphql();
  return { items: viaGql, source: "graphql" };
}

async function main() {
  if (!DEPLOYED_SHA) {
    log("DEPLOYED_SHA missing; skip board move");
    process.exit(1);
  }
  if (!TOKEN) {
    log("No GitHub token; set PROJECT_TOKEN (PAT with project scope)");
    process.exit(1);
  }
  if (!HAS_PROJECT_TOKEN) {
    log(
      "PROJECT_TOKEN unset. Actions GITHUB_TOKEN often cannot list/write the user project; configure repo secret PROJECT_TOKEN (classic PAT: project + repo)."
    );
    process.exit(1);
  }
  if (!existsSync(REPO_DIR)) {
    log(`Repo dir missing (${REPO_DIR}); cannot resolve ancestry`);
    process.exit(1);
  }

  let moved = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const { items: waiting, source } = await listWaitingDeploy();
    log(
      `Waiting Deploy count=${waiting.length} via ${source}; deployed=${DEPLOYED_SHA.slice(0, 12)}`
    );

    for (const item of waiting) {
      const { number, id: itemId, title } = item;
      const mergeSha = resolveMergeSha(number);
      if (!mergeSha) {
        log(`#${number}: no merge SHA on tip (${title.slice(0, 48)}); leave Waiting Deploy`);
        skipped += 1;
        continue;
      }
      if (!containedInDeploy(mergeSha)) {
        log(
          `#${number}: merge ${mergeSha.slice(0, 12)} not in deploy tip; leave`
        );
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
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  log(`fatal: ${(err && err.message) || err}`);
  process.exit(1);
});
