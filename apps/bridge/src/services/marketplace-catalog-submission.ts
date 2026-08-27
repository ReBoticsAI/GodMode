import type { CoreDatabase } from "../core-db.js";
import type { AppDatabase } from "../db.js";
import {
  assertMarketplaceTosAccepted,
  assertNotMarketplaceBanned,
  assertStripeConnectAttestation,
} from "./marketplace-commerce.js";
import { createGithubPullRequest } from "./coding/github-pr.js";
import {
  createGithubBranch,
  decodeGithubContent,
  ensureGithubFork,
  getGithubBranchSha,
  getGithubAuthenticatedUser,
  getGithubFileContent,
  putGithubFileContent,
} from "./coding/github-contents.js";
import { resolveCodingGithubAccessToken } from "./coding/git-host-auth.js";

export const COMMUNITY_MARKETPLACE_UPSTREAM = {
  owner: "ReBoticsAI",
  repo: "GodMode-Marketplace",
} as const;

export const COMMUNITY_INDEX_PATH = "catalog/community/index.json";

export type CommunityCatalogInstallType = "plugin" | "clone";

export type PrepareCommunityCatalogSubmissionInput = {
  id: string;
  title: string;
  description: string;
  installType: CommunityCatalogInstallType;
  kind?: string;
  version?: string;
  pluginRepo?: string;
  pluginRef?: string;
  bundlePath?: string;
  ciRunUrl?: string;
  /** Community Live Share (#596). Only valid with installType clone. */
  deliveryMode?: "clone" | "live";
  tags?: string[];
  stripeConnectAttestation?: boolean;
};

export type CommunityCatalogSubmissionBlocker = {
  code: string;
  message: string;
};

export type PrepareCommunityCatalogSubmissionResult = {
  entry: Record<string, unknown>;
  blockers: CommunityCatalogSubmissionBlocker[];
  readyToSubmit: boolean;
  githubLogin: string | null;
};

export type SubmitCommunityCatalogSubmissionResult = {
  catalogEntryId: string;
  prNumber: number;
  prUrl: string;
  branch: string;
  forkOwner: string;
};

function normalizeCatalogId(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

function assertCatalogId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(id) && !/^[a-z0-9]{1,2}$/.test(id)) {
    throw Object.assign(
      new Error("Catalog id must be lowercase kebab-case (letters, numbers, hyphens)"),
      { status: 400 }
    );
  }
}

function buildCatalogEntry(
  input: PrepareCommunityCatalogSubmissionInput,
  author: string
): Record<string, unknown> {
  const id = normalizeCatalogId(input.id);
  const installType = input.installType;
  const kind =
    installType === "plugin"
      ? "plugin"
      : String(input.kind ?? "skill").trim() || "skill";
  const entry: Record<string, unknown> = {
    id,
    kind,
    installType,
    title: String(input.title ?? "").trim(),
    description: String(input.description ?? "").trim(),
    version: String(input.version ?? "0.1.0").trim() || "0.1.0",
    author,
  };
  const pluginRepo = String(input.pluginRepo ?? "").trim();
  if (pluginRepo) entry.pluginRepo = pluginRepo;
  const pluginRef = String(input.pluginRef ?? "").trim();
  if (pluginRef) entry.pluginRef = pluginRef;
  const bundlePath = String(input.bundlePath ?? "").trim();
  if (bundlePath) entry.bundlePath = bundlePath;
  const ciRunUrl = String(input.ciRunUrl ?? "").trim();
  if (ciRunUrl) entry.ciRunUrl = ciRunUrl;
  const deliveryMode = String(input.deliveryMode ?? "").trim().toLowerCase();
  if (deliveryMode === "live" || deliveryMode === "clone") {
    entry.deliveryMode = deliveryMode;
  }
  const tags = (input.tags ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (tags.length) entry.tags = tags;
  return entry;
}

function submissionBlockers(
  entry: Record<string, unknown>,
  installType: CommunityCatalogInstallType
): CommunityCatalogSubmissionBlocker[] {
  const blockers: CommunityCatalogSubmissionBlocker[] = [];
  if (!entry.title) blockers.push({ code: "title", message: "Title is required." });
  if (!entry.description) blockers.push({ code: "description", message: "Description is required." });
  if (!entry.pluginRepo) {
    blockers.push({ code: "pluginRepo", message: "pluginRepo (GitHub repo URL) is required." });
  }
  if (installType === "plugin") {
    if (!entry.pluginRef) {
      blockers.push({
        code: "pluginRef",
        message: "pluginRef (pinned tag or SHA) is required for plugins.",
      });
    }
    if (!entry.ciRunUrl) {
      blockers.push({
        code: "ciRunUrl",
        message: "ciRunUrl (green Actions run for pluginRef) is required for new plugins.",
      });
    }
  }
  if (installType === "clone" && !entry.bundlePath) {
    blockers.push({
      code: "bundlePath",
      message: "bundlePath (path to bundle.json in the repo) is required for clone packs.",
    });
  }
  if (installType === "clone" && !entry.pluginRef) {
    blockers.push({
      code: "pluginRef",
      message: "pluginRef (pinned repo ref) is required for clone packs.",
    });
  }
  if (String(entry.deliveryMode ?? "").trim().toLowerCase() === "live") {
    if (installType !== "clone") {
      blockers.push({
        code: "deliveryMode",
        message: "deliveryMode live requires installType clone.",
      });
    }
  }
  return blockers;
}

export async function prepareCommunityCatalogSubmission(opts: {
  core: CoreDatabase;
  userDb: AppDatabase;
  userId: string;
  input: PrepareCommunityCatalogSubmissionInput;
}): Promise<PrepareCommunityCatalogSubmissionResult> {
  assertNotMarketplaceBanned(opts.core, opts.userId);
  assertMarketplaceTosAccepted(opts.core, opts.userId);
  assertStripeConnectAttestation(
    opts.core,
    opts.userId,
    opts.input.stripeConnectAttestation
  );

  const id = normalizeCatalogId(opts.input.id);
  assertCatalogId(id);

  let githubLogin: string | null = null;
  try {
    const token = await resolveCodingGithubAccessToken(opts.userDb);
    const user = await getGithubAuthenticatedUser(token);
    githubLogin = String(user.login ?? "").trim() || null;
  } catch {
    githubLogin = null;
  }

  const blockers: CommunityCatalogSubmissionBlocker[] = [];
  if (!githubLogin) {
    blockers.push({
      code: "github_connect",
      message:
        "Connect GitHub before submitting to the Community catalog. The catalog author is your GitHub login.",
    });
  }

  // Community author is always the submitter's GitHub login (never a display name).
  const author = githubLogin ?? "";
  const entry = buildCatalogEntry({ ...opts.input, id }, author || "unknown");
  blockers.push(...submissionBlockers(entry, opts.input.installType));

  return {
    entry,
    blockers,
    readyToSubmit: blockers.length === 0,
    githubLogin,
  };
}

type CommunityIndexFile = {
  version?: number;
  repoBase?: string;
  updatedAt?: string;
  entries: Array<Record<string, unknown>>;
};

function mergeCommunityIndexEntry(
  index: CommunityIndexFile,
  entry: Record<string, unknown>
): CommunityIndexFile {
  const id = String(entry.id ?? "");
  const entries = Array.isArray(index.entries) ? [...index.entries] : [];
  const existingIdx = entries.findIndex((e) => String(e.id ?? "") === id);
  if (existingIdx >= 0) {
    entries[existingIdx] = { ...entries[existingIdx], ...entry };
  } else {
    entries.push(entry);
  }
  return {
    ...index,
    entries,
    updatedAt: new Date().toISOString(),
  };
}

export async function submitCommunityCatalogSubmission(opts: {
  core: CoreDatabase;
  userDb: AppDatabase;
  userId: string;
  input: PrepareCommunityCatalogSubmissionInput;
  signal?: AbortSignal;
}): Promise<SubmitCommunityCatalogSubmissionResult> {
  const throwIfAborted = () => {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error("Catalog submission cancelled"), {
        status: 499,
        code: "ABORTED",
      });
    }
  };

  throwIfAborted();
  const prepared = await prepareCommunityCatalogSubmission(opts);
  if (!prepared.readyToSubmit) {
    const msg = prepared.blockers.map((b) => b.message).join(" ");
    throw Object.assign(new Error(msg || "Catalog submission is not ready"), { status: 400 });
  }

  throwIfAborted();
  const token = await resolveCodingGithubAccessToken(opts.userDb);
  const entry = prepared.entry;
  const catalogEntryId = String(entry.id ?? "");

  throwIfAborted();
  const fork = await ensureGithubFork(
    token,
    COMMUNITY_MARKETPLACE_UPSTREAM.owner,
    COMMUNITY_MARKETPLACE_UPSTREAM.repo
  );

  throwIfAborted();
  const baseSha = await getGithubBranchSha(token, fork.owner, fork.repo, fork.defaultBranch);
  const branch = `catalog/${catalogEntryId}-${Date.now()}`;
  await createGithubBranch(token, fork.owner, fork.repo, branch, baseSha);

  throwIfAborted();
  const file = await getGithubFileContent(
    token,
    fork.owner,
    fork.repo,
    COMMUNITY_INDEX_PATH,
    branch
  );
  const index = JSON.parse(decodeGithubContent(file)) as CommunityIndexFile;
  if (!Array.isArray(index.entries)) {
    throw Object.assign(new Error("Community index is missing entries array"), { status: 502 });
  }
  const duplicate = index.entries.some((e) => String(e.id ?? "") === catalogEntryId);
  if (duplicate) {
    throw Object.assign(
      new Error(
        `Catalog entry "${catalogEntryId}" already exists in your fork. Sync with upstream or edit the existing row.`
      ),
      { status: 409 }
    );
  }

  throwIfAborted();
  const merged = mergeCommunityIndexEntry(index, entry);
  const contentUtf8 = `${JSON.stringify(merged, null, 2)}\n`;
  await putGithubFileContent({
    token,
    owner: fork.owner,
    repo: fork.repo,
    path: COMMUNITY_INDEX_PATH,
    branch,
    message: `catalog(community): add ${catalogEntryId}`,
    contentUtf8,
    sha: file.sha,
  });

  throwIfAborted();
  const pr = await createGithubPullRequest({
    accessToken: token,
    owner: COMMUNITY_MARKETPLACE_UPSTREAM.owner,
    repo: COMMUNITY_MARKETPLACE_UPSTREAM.repo,
    title: `Community catalog: ${entry.title}`,
    body: [
      `Adds \`${catalogEntryId}\` to \`${COMMUNITY_INDEX_PATH}\`.`,
      "",
      "Submitted from GodMode Sell → Submit to Community catalog.",
      "",
      "Part of Community Marketplace intake (#571).",
    ].join("\n"),
    head: `${fork.owner}:${branch}`,
    base: fork.defaultBranch,
    draft: false,
  });

  return {
    catalogEntryId,
    prNumber: pr.number,
    prUrl: pr.htmlUrl,
    branch,
    forkOwner: fork.owner,
  };
}
