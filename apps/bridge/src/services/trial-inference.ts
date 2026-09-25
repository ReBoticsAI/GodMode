import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AppDatabase } from "../db.js";
import type { CoreDatabase } from "../core-db.js";
import { getCloudDb } from "../core-db.js";
import { ensureTrialInferenceTables } from "./trial-inference-schema.js";
import {
  OPENROUTER_API_BASE_URL,
  OPENROUTER_API_KEY_SECRET_ID,
  OPENROUTER_API_KEY_SECRET_NAME,
  OPENROUTER_TOP10_CATALOG,
  isOpenRouterPlatformReady,
  upsertOpenRouterApiKey,
} from "./openrouter-platform.js";
import { getPlatformVaultSecretInScope, getAgent } from "./agents/agents-db.js";
import { markLlmReady } from "./onboarding.js";
import { selectIntelligenceModel } from "./model-catalog.js";
import type { LlmManager } from "./llm-manager.js";
import {
  isGodModeInferenceSupplyReady,
  pickGodModeInferenceSupplyTarget,
  resolveGodModeInferenceSupplyKey,
} from "./godmode-inference-supply.js";
import {
  defaultTrialBudgetUsd,
  findActiveGodModeInferenceGrant,
  isGrantSpendable,
} from "./godmode-inference-grants.js";
import { config } from "../config.js";

/**
 * First-land trial inference (#758).
 *
 * Product decision (signup guide): DeepSeek + GLM (Z.ai) + Qwen (DashScope)
 * platform token plans under OUR accounts. Hard per-user spend cap (default
 * $0.10). These models exist only to guide new users through landing → talk →
 * sign up for GodMode Inference (Local and/or Cloud). Not general chat.
 * Personal BYOK remains advanced / after signup.
 */

/**
 * Fallback first-land greeting (no display name).
 * UI may seed this without a model turn. Keep in sync with buildFirstLandGreeting().
 */
export const FIRST_LAND_GREETING =
  "Hey. I have a tiny GodMode Inference allowance to show you around. This is your GodMode welcome tour. Ask about the Graph, buying more Inference, or connecting DeepSeek / Z.AI / Qwen. When you are ready, create your account or top up.";

/** Vault path copy for supported BYOK (DeepSeek / Z.AI / Qwen). */
export const TRIAL_PASTE_KEY_PATH = "Vault → Inference → Supported";

/**
 * GodMode Inference purchase / top-up path (Vault Inference panel).
 */
export const TRIAL_PAY_GODMODE_PATH = "/platform-vault?vault=inference&sub=godmode";

export const TRIAL_PRIMARY_CTA_LABEL = "Get GodMode Inference";
export const TRIAL_PAY_CTA_LABEL = "Buy $1 more";
/** Cloud seat / account billing surface (SaaS). */
export const TRIAL_CLOUD_SEAT_PATH = "/settings?tab=account";
export const TRIAL_CLOUD_SEAT_CTA_LABEL = "Cloud seat";
export const TRIAL_PAY_CTA_LABEL_SAAS = "Buy Inference";
export const TRIAL_CONVERT_HINT_SAAS =
  "On GodMode Cloud: keep a Cloud seat, then buy GodMode Inference (or use Supported BYOK).";
export const TRIAL_CONVERT_HINT_LOCAL =
  "On GodMode Local: buy GodMode Inference for this install, or connect Supported BYOK / a local model.";

/**
 * Default welcome-guide model when only OpenRouter shared fallback is set.
 * Prefer DeepSeek / GLM / Qwen via their platform keys when configured.
 */
export const TRIAL_DEFAULT_MODEL_ID =
  OPENROUTER_TOP10_CATALOG[0]?.id ?? "openrouter/free";

/** Default hard cap per new user on welcome-guide Inference. */
export const TRIAL_DEFAULT_BUDGET_USD = 0.1;

/**
 * Advanced BYOK / personal keys page (secondary CTA only).
 * Override with TRIAL_AFFILIATE_SIGNUP_URL when you have a tracked referral link.
 */
export const DEFAULT_TRIAL_AFFILIATE_SIGNUP_URL =
  "https://openrouter.ai/keys";

/**
 * System / harness delta for signup-guide mode.
 * Injected so the model stays on onboarding + GodMode Inference conversion.
 */
export const SIGNUP_GUIDE_HARNESS_DELTA = [
  "<model_profile id=\"godmode-signup-guide\">",
  "You are the GodMode welcome guide. This chat explains GodMode and helps a visitor choose how to move forward. It is not a build session.",
  "The control surface is the 3D Graph. Never mention a sidebar.",
  "A visitor may start from Create, Earn, Organize, Automate, Explore, Battle, Social, or Learn.",
  "Create means making things in GodMode. Content, plugins, and workflows are examples, not the whole list. Also talk about pages, agents, structure, knowledge, memories, skills, rules, artifacts, tools, automations, schedules, and other Graph nodes.",
  "Earn means selling what they make. If they want to earn while keeping this GodMode instance local, offer the desktop download for their operating system from https://godmode.software/downloads (Windows, macOS, or Linux), then a GodMode Seller account. That account is commerce only. It is not a full GodMode Cloud workspace, and their work stays on this machine. Put the Seller point on a marketplace tour stop. Do not quote a Seller price. Do not invent a direct file URL. Organize means managing it. Automate means automating it.",
  "Explore, Battle, Social, and Learn are the open universe: maneuvering a structure in space, encountering a hostile, encountering a friendly, and gaining knowledge by connecting to others. Explain that direction. Do not invent a live battle screen.",
  "You may suggest what could be built later. Do not start building it, and do not offer to create departments, pages, plugins, or workflows in this chat. The Inference allowance will run out before a build finishes.",
  "When you explain an interest, call play_graph_tour once with 4 to 6 stops. Each stop is a node (you, hub, intelligence, platform_vault, personal_vault, bank, wiki, workspaces, marketplace) and one sentence in say. For 10 seconds the Graph zooms out beside the chat and highlights the connection from You to that node. Then it moves to the next stop. Do not say you opened or zoomed into a page. Do not call focus_graph_node for this tour. Do not write the tour sentences in your message.",
  "After the tour, call ask_guide_choice once. That shows buttons for the desktop download, GodMode Inference, GodMode Cloud, Cloud with Inference, and GodMode Seller. Do not write that choice as a sentence.",
  "Stay on: what GodMode is, the 3D Graph (You, Hub, Intelligence, Workspaces, Vaults), auth/signup, GodMode Inference, GodMode Cloud, Local models, Supported BYOK (DeepSeek / Z.AI / Qwen).",
  "When the user asks about pricing, buying Inference, Vault, BYOK, or where something lives: call open_guide_surface or focus_graph_node to SHOW the UI. Do not invent pack prices; open godmode_inference so they see live pricing.",
  "Guide tools available this turn: open_guide_surface (godmode_inference, supported_byok, platform_vault, personal_vault, bank, wiki, intelligence_chat), focus_graph_node (you, hub, intelligence, platform_vault, personal_vault, bank, wiki, workspaces, marketplace), play_graph_tour, and ask_guide_choice.",
  "If the user asks for unrelated coding, homework, general knowledge, or long free-form chat, briefly refuse and steer them to sign up for GodMode Inference or GodMode Cloud with Inference.",
  "Do not invent vendor partnerships. Prefer short turns.",
  "</model_profile>",
].join("\n");

const INTELLIGENCE_INTEREST_GUIDES: Record<string, string> = {
  create:
    "Create means making things in GodMode. Content, plugins, and workflows are examples, not the whole list. Also cover pages, agents, structure, knowledge, memories, skills, rules, artifacts, tools, automations, schedules, hooks, and other nodes on the 3D Graph.",
  earn: "Earn means selling what they make, including listings others can buy. Do not limit this to workflows. If they want to earn while keeping this GodMode instance local, they add a GodMode Seller account. That account is commerce only: it lets them sell on the Community marketplace. It is not a full GodMode Cloud workspace, and their files stay on this machine. Do not quote a Seller price.",
  organize:
    "Organize means managing what they make: structure, pages, agents, knowledge, and the rest of the Graph. Do not limit this to workflows.",
  automate:
    "Automate means automating what they make: workflows, schedules, hooks, and agents that keep the work moving. Do not limit this to one workflow.",
  explore:
    "Explore means maneuvering your structure in space, in the open multiplayer universe.",
  battle:
    "Battle means encountering a hostile in space. Explain that direction. Do not invent a live battle screen.",
  social:
    "Social means encountering a friendly in space. Explain that direction.",
  learn:
    "Learn means gaining access to new knowledge by connecting to others in space.",
};

export const LOCAL_DOWNLOADS_URL = "https://godmode.software/downloads";

export type GuideDesktopOs = "windows" | "macos" | "linux";

const GUIDE_OS_LABEL: Record<GuideDesktopOs, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

/** Accept a client OS hint. Unknown values stay unset so the model does not invent one. */
export function normalizeGuideDesktopOs(
  raw: string | null | undefined
): GuideDesktopOs | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "windows" || value === "win" || value === "win32") return "windows";
  if (value === "macos" || value === "mac" || value === "darwin") return "macos";
  if (value === "linux") return "linux";
  return null;
}

/** Offer the desktop build for staying local instead of GodMode Cloud. */
export function localDownloadOffer(os: GuideDesktopOs | null): string {
  if (!os) {
    return `If they want to stay local instead of GodMode Cloud, offer the desktop download for their operating system from ${LOCAL_DOWNLOADS_URL}. That page has Windows, macOS, and Linux. Do not invent a direct file URL.`;
  }
  const label = GUIDE_OS_LABEL[os];
  return `If they want to stay local instead of GodMode Cloud, offer the ${label} desktop download. The visitor is on ${label}. Send them to ${LOCAL_DOWNLOADS_URL} and name the ${label} build. Do not invent a direct file URL.`;
}

/**
 * Model-only brief for a starting interest. The stored user message stays the label.
 * Appended on welcome-guide turns so the reply is not a closed reading of one example.
 */
export function interestModelGuide(
  id: string,
  clientOs?: string | null
): string | null {
  const body = INTELLIGENCE_INTEREST_GUIDES[id];
  if (!body) return null;
  const os = normalizeGuideDesktopOs(clientOs);
  return [
    "Welcome-guide turn. The visitor chose this interest. Answer it. Do not treat the examples as the whole product.",
    body,
    "The map is the 3D Graph. Do not mention a sidebar.",
    "Explain how GodMode can do this by calling play_graph_tour once. Use 4 to 6 stops on you, hub, intelligence, platform_vault, personal_vault, bank, wiki, workspaces, or marketplace. Each say is one sentence for that node. The Graph zooms out beside the chat and highlights the path from You to that node for 10 seconds, then moves on. Do not write those sentences yourself. Do not call focus_graph_node for the tour.",
    "Suggesting what could be built later is fine. Do not start building it in this chat. This allowance will run out before a build finishes.",
    "After the tour tool returns, call ask_guide_choice once. The buttons are the desktop download, GodMode Inference, GodMode Cloud, GodMode Cloud with Inference, and GodMode Seller. Do not write that choice as a sentence.",
    ...(id === "earn"
      ? [
          "For Earn, one of those stops must be marketplace. In that stop's say, explain the local path: keep this GodMode instance local and add a GodMode Seller account to sell. Seller is commerce only, not a full GodMode Cloud workspace. Do not quote a price.",
          localDownloadOffer(os),
        ]
      : []),
  ].join("\n");
}

/**
 * Model-only brief after a next-step button. The stored user message stays the label.
 */
export function pathModelGuide(
  id: string,
  clientOs?: string | null
): string | null {
  const os = normalizeGuideDesktopOs(clientOs);
  const osLabel = os ? GUIDE_OS_LABEL[os] : "their operating system";
  const bodies: Record<string, string> = {
    download: `They chose the desktop download so they can stay local instead of GodMode Cloud. Explain that GodMode for ${osLabel} runs on their computer and their files stay there. They do not need a Cloud workspace for that. If they also want managed models, they add GodMode Inference on top of that local install. That is Local with Inference. Send them to ${LOCAL_DOWNLOADS_URL} and name the ${osLabel} build. Do not invent a direct file URL or a price.`,
    inference:
      "They chose GodMode Inference only. Explain that Inference is the model supply, packs or a subscription, not a hosted workspace. It works on a local install or on GodMode Cloud. Local with Inference means the app stays on their computer. Cloud with Inference means the workspace is hosted and the models come from GodMode. Call open_guide_surface with godmode_inference so they see live prices. Do not invent prices.",
    cloud:
      "They chose GodMode Cloud. Explain that Cloud is the hosted workspace: they use GodMode from any device without running it on this computer. They can bring their own model keys. If they want GodMode to supply the models too, that is Cloud with Inference, a different choice. Do not invent prices.",
    cloud_inference:
      "They chose GodMode Cloud with Inference. Explain why both pieces are there: Cloud hosts the workspace so they are not running GodMode on this computer, and Inference supplies the models so agents can run without their own keys. Contrast Local with Inference: the app stays on their machine and Inference is only the model supply. Call open_guide_surface with godmode_inference so they see live prices. Do not invent prices.",
    seller: `They chose a GodMode Seller account. Explain that Seller is the commerce seat for selling on the Community marketplace from a local install. It is not a full GodMode Cloud workspace, and their files stay on this machine. If they do not have the app yet, they still download GodMode for ${osLabel} from ${LOCAL_DOWNLOADS_URL}. Do not quote a price.`,
  };
  const body = bodies[id];
  if (!body) return null;
  return [
    "Welcome-guide follow-up. The visitor picked this next step. Explain that choice. Do not start a build.",
    body,
    "The map is the 3D Graph. Do not mention a sidebar.",
  ].join("\n");
}

/** Topics allowed in signup-guide mode (substring match, case-insensitive). */
const SIGNUP_GUIDE_ALLOW_TERMS = [
  "godmode",
  "inference",
  "sign up",
  "signup",
  "sign-in",
  "signin",
  "account",
  "auth",
  "graph",
  "workspace",
  "vault",
  "intelligence",
  "hub",
  "cloud",
  "bridge",
  "local",
  "onboard",
  "welcome",
  "trial",
  "plan",
  "pricing",
  "price",
  "cost",
  "buy",
  "token",
  "model",
  "deepseek",
  "qwen",
  "z.ai",
  "zai",
  "glm",
  "subscribe",
  "subscription",
  "how do i",
  "what is",
  "where is",
  "help",
];

export function isSignupGuideModeEnabled(): boolean {
  const raw = readEnv("TRIAL_SIGNUP_GUIDE");
  if (raw === "false" || raw === "0") return false;
  return true;
}

/**
 * Soft topic gate for welcome-guide chat.
 * Empty / very short prompts pass (UI may send greetings).
 */
export function isSignupGuideTopic(message: string): boolean {
  const text = (message || "").trim().toLowerCase();
  if (text.length < 8) return true;
  return SIGNUP_GUIDE_ALLOW_TERMS.some((t) => text.includes(t));
}

export const SIGNUP_GUIDE_REFUSAL =
  "This welcome chat is only for learning GodMode and using GodMode Inference. Ask about the Graph, buying more Inference, Local models, or connecting DeepSeek / Z.AI / Qwen in Vault.";

/**
 * Best-effort personal OpenRouter signup entry (browser / email wall).
 * Advanced BYOK only. OpenRouter has no public create-account-by-email API.
 */
export const DEFAULT_OPENROUTER_SIGNIN_URL = "https://openrouter.ai/sign-in";

export type TrialProvisionMechanism =
  | "mgmtApi"
  | "platformShared"
  | "godmodeInferenceSupply"
  | "browser"
  | "computerUse"
  | "terminal"
  | "none";

export type TrialGrantStatus =
  | "active"
  | "converted"
  | "expired"
  | "revoked"
  | "failed"
  | "unconfigured"
  | "deferred_until_auth"
  | "deferred_mechanism";

/** How far we got toward a *personal* OpenRouter account (not our mgmt mint). */
export type OpenRouterSignupInitiation =
  | "deep_link"
  | "unavailable"
  | "deferred_until_email";

export interface TrialInferenceStatus {
  ready: boolean;
  mechanism: TrialProvisionMechanism;
  modelId: string;
  greeting: string;
  status: TrialGrantStatus;
  expiresAt: string | null;
  promptThreshold: number;
  ttlDays: number;
  detail?: string;
  /** Primary convert: keep chatting on GodMode Inference. */
  primaryCtaLabel: string;
  /** Pay path: Vault GodMode Inference checkout. */
  payGodModePath: string;
  payCtaLabel: string;
  /** saas | local: shapes convert copy. */
  deploymentSurface: "saas" | "local";
  /** Short convert hint under CTAs (Cloud seat + Inference vs Local Inference/BYOK). */
  convertHint: string;
  /** SaaS-only: Account / seat path. Empty on Local. */
  cloudSeatPath: string;
  cloudSeatCtaLabel: string;
  /**
   * Advanced BYOK: personal OpenRouter keys / credit top-up (secondary CTA).
   * Not the primary convert playbook.
   */
  affiliateSignupUrl: string;
  /**
   * Best-effort personal OpenRouter signup URL (may include email query hint).
   * Advanced BYOK only. OpenRouter does not expose account-create or magic-link APIs.
   */
  personalSignupUrl: string;
  /** Whether we prepared a personal-account deep link (never a server-side invite). */
  signupInitiation: OpenRouterSignupInitiation;
  /** GodMode account email when known (also used for advanced OpenRouter deep-link hint). */
  signupEmail: string | null;
  /**
   * OpenRouter username / handle. Advanced BYOK only; never used in the genie greeting.
   * Null on the mgmt-mint / platform shared path.
   */
  openRouterUserName: string | null;
  /** Where to paste an advanced BYOK OpenRouter key. */
  pasteKeyPath: string;
  configured: {
    mgmtApi: boolean;
    platformShared: boolean;
    godmodeInferenceSupply: boolean;
  };
  /** Remaining ops for full #758 mint / convert / pay-GodMode (not built in this slice). */
  remainingOps: string[];
}

export interface EnsureTrialInferenceOpts {
  userId?: string | null;
  visitorKey?: string | null;
  /** Client IP for soft visitor heuristics / rate subject (hashed, not stored raw). */
  clientIp?: string | null;
  /** GodMode account email when known (auth or guest-with-email). */
  email?: string | null;
  /** Display name for personalized genie greeting. */
  displayName?: string | null;
  tenantDb?: AppDatabase | null;
  llm?: LlmManager | null;
  /** When true, attempt mint / vault attach (authenticated path). */
  provision?: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
  db?: CoreDatabase;
}

/** Build personalized first-land / convert greeting (no em-dashes). */
export function buildFirstLandGreeting(opts?: {
  displayName?: string | null;
  email?: string | null;
  /** Ignored: greeting uses GodMode display name / email only. */
  openRouterUserName?: string | null;
}): string {
  const display = opts?.displayName?.trim();
  const first = display ? display.split(/\s+/)[0] : "";
  const hey = first ? `Hey ${first}` : "Hey";
  const email = opts?.email?.trim();
  const brandBit = email
    ? ` This welcome tour is for ${email}.`
    : " This is your GodMode welcome tour.";
  return `${hey}. I have a tiny GodMode Inference allowance to show you around.${brandBit} Ask about the Graph, buying more Inference, or connecting DeepSeek / Z.AI / Qwen. When you are ready, create your account or top up.`;
}

/**
 * Best-effort personal OpenRouter signup URL.
 * Prefills email query params when known; OpenRouter may ignore unknown params.
 */
export function buildPersonalOpenRouterSignupUrl(opts?: {
  email?: string | null;
  baseSignupUrl?: string | null;
}): { url: string; initiation: OpenRouterSignupInitiation; email: string | null } {
  const email = opts?.email?.trim() || null;
  const base =
    (opts?.baseSignupUrl?.trim() ||
      readEnv("TRIAL_AFFILIATE_SIGNUP_URL") ||
      DEFAULT_OPENROUTER_SIGNIN_URL).replace(/\/$/, "") ||
    DEFAULT_OPENROUTER_SIGNIN_URL;
  if (!email) {
    return {
      url: base.includes("openrouter.ai")
        ? base
        : DEFAULT_OPENROUTER_SIGNIN_URL,
      initiation: "deferred_until_email",
      email: null,
    };
  }
  try {
    const u = new URL(
      base.startsWith("http") ? base : DEFAULT_OPENROUTER_SIGNIN_URL
    );
    // Best-effort hints; OpenRouter OAuth docs do not document email prefill.
    if (!u.searchParams.has("email")) u.searchParams.set("email", email);
    if (!u.searchParams.has("login_hint")) {
      u.searchParams.set("login_hint", email);
    }
    return { url: u.toString(), initiation: "deep_link", email };
  } catch {
    return {
      url: `${DEFAULT_OPENROUTER_SIGNIN_URL}?email=${encodeURIComponent(email)}&login_hint=${encodeURIComponent(email)}`,
      initiation: "deep_link",
      email,
    };
  }
}

function resolveUserIdentity(
  db: CoreDatabase,
  opts: EnsureTrialInferenceOpts
): { email: string | null; displayName: string | null } {
  let email = opts.email?.trim() || null;
  let displayName = opts.displayName?.trim() || null;
  if (opts.userId && (!email || !displayName)) {
    try {
      const row = db
        .prepare(`SELECT email, display_name FROM users WHERE id=?`)
        .get(opts.userId) as
        | { email: string; display_name: string }
        | undefined;
      if (row) {
        email = email || row.email?.trim() || null;
        displayName = displayName || row.display_name?.trim() || null;
      }
    } catch {
      // users table may be absent in unit fixtures that only stub grants.
    }
  }
  return { email, displayName };
}

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

// buildPersonalOpenRouterSignupUrl uses readEnv (defined above).

function parseOrder(): TrialProvisionMechanism[] {
  const raw =
    readEnv("TRIAL_PROVISION_ORDER") ||
    "godmodeInferenceSupply";
  const allowed = new Set<TrialProvisionMechanism>([
    "godmodeInferenceSupply",
    "mgmtApi",
    "platformShared",
    "browser",
    "computerUse",
    "terminal",
  ]);
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is TrialProvisionMechanism =>
      allowed.has(s as TrialProvisionMechanism)
    );
  return parts.length
    ? parts
    : ["godmodeInferenceSupply", "mgmtApi", "platformShared"];
}

export function trialInferenceConfig() {
  const ttlDays = Math.max(1, Number(readEnv("TRIAL_KEY_TTL_DAYS") || 30));
  const budgetUsd = Math.max(0.01, defaultTrialBudgetUsd());
  const promptThreshold = Math.max(
    1,
    Number(readEnv("TRIAL_PROMPT_THRESHOLD") || 5)
  );
  const modelId = readEnv("TRIAL_DEFAULT_MODEL_ID") || TRIAL_DEFAULT_MODEL_ID;
  const mgmtKey = readEnv("OPENROUTER_MANAGEMENT_API_KEY");
  const platformKey =
    readEnv("TRIAL_PLATFORM_API_KEY") || readEnv("OPENROUTER_API_KEY");
  const deepseekKey = resolveGodModeInferenceSupplyKey("deepseek") ?? "";
  const zaiKey = resolveGodModeInferenceSupplyKey("zai") ?? "";
  const dashscopeKey = resolveGodModeInferenceSupplyKey("dashscope") ?? "";
  const allowVisitorMint = readEnv("TRIAL_ALLOW_VISITOR_MINT") === "true";
  const cloudTrialUrl = readEnv("CLOUD_TRIAL_URL");
  const affiliateSignupUrl =
    readEnv("TRIAL_AFFILIATE_SIGNUP_URL") || DEFAULT_TRIAL_AFFILIATE_SIGNUP_URL;
  const signupGuide = isSignupGuideModeEnabled();
  return {
    ttlDays,
    budgetUsd,
    promptThreshold,
    modelId,
    mgmtKey,
    platformKey,
    deepseekKey,
    zaiKey,
    dashscopeKey,
    allowVisitorMint,
    cloudTrialUrl,
    affiliateSignupUrl,
    signupGuide,
    order: parseOrder(),
  };
}

export function hashTrialSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newVisitorKey(): string {
  return `v_${randomBytes(16).toString("hex")}`;
}

export function subjectKeyFor(opts: {
  userId?: string | null;
  visitorKey?: string | null;
  clientIp?: string | null;
}): string {
  if (opts.userId) return `user:${opts.userId}`;
  const visitor = opts.visitorKey?.trim() || "anon";
  const ipHash = hashTrialSecret(opts.clientIp?.trim() || "unknown-ip").slice(
    0,
    16
  );
  return `visitor:${visitor}:${ipHash}`;
}

function remainingOpsNote(cfg: ReturnType<typeof trialInferenceConfig>): string[] {
  const notes: string[] = [];
  if (!cfg.mgmtKey) {
    notes.push(
      "Set OPENROUTER_MANAGEMENT_API_KEY for per-user OpenRouter Management API mint (POST /api/v1/keys under OUR OpenRouter account / GodMode Inference supply)."
    );
  }
  if (!cfg.platformKey) {
    notes.push(
      "Set TRIAL_PLATFORM_API_KEY (or OPENROUTER_API_KEY) for shared platform trial fallback."
    );
  }
  if (!isGodModeInferenceSupplyReady()) {
    notes.push(
      "Configure Admin → GodMode Inference (DeepSeek / Z.AI / Qwen) or set DEEPSEEK_API_KEY / ZAI_API_KEY / DASHSCOPE_API_KEY for signup-guide supply."
    );
  }
  notes.push(
    `GodMode Inference packs and subscriptions: ${TRIAL_PAY_GODMODE_PATH} (POST /api/godmode-inference/checkout).`
  );
  notes.push(
    "Prompt-threshold convert playbook should nudge buy more GodMode Inference or Supported BYOK. Key revoke/expiry job remains on #758."
  );
  notes.push(
    "Supported BYOK is DeepSeek / Z.AI / Qwen (pasteKeyPath). Other providers are Advanced BYOK."
  );
  notes.push(
    `Advanced BYOK CTA URL: ${cfg.affiliateSignupUrl} (set TRIAL_AFFILIATE_SIGNUP_URL to override).`
  );
  notes.push(
    "OpenRouter has no public create-account / magic-link / invite-by-email API. Personal accounts require browser signup or OAuth PKCE."
  );
  notes.push(
    "Browser / computerUse / terminal provisioners are deferred (see GitHub #758)."
  );
  notes.push(
    "Marketplace P2P inference routing (sellers list spare capacity → GodMode routes trial/paid demand → settlement) is future. Hub listing kind inference exists; do not fake a working marketplace."
  );
  notes.push(
    "Full unlock tutorial cascade and 3D WebGL canvas are separate tracks (not this slice)."
  );
  return notes;
}

function baseStatus(
  partial: Partial<TrialInferenceStatus> &
    Pick<TrialInferenceStatus, "ready" | "mechanism" | "status">,
  identity?: { email?: string | null; displayName?: string | null }
): TrialInferenceStatus {
  const cfg = trialInferenceConfig();
  const signup = buildPersonalOpenRouterSignupUrl({
    email: identity?.email ?? partial.signupEmail,
    baseSignupUrl:
      readEnv("TRIAL_PERSONAL_SIGNUP_URL") || DEFAULT_OPENROUTER_SIGNIN_URL,
  });
  const greeting =
    partial.greeting ??
    buildFirstLandGreeting({
      displayName: identity?.displayName,
      email: identity?.email ?? signup.email,
    });
  const deploymentSurface: "saas" | "local" =
    partial.deploymentSurface ?? (config.isSaas ? "saas" : "local");
  const convertHint =
    partial.convertHint ??
    (deploymentSurface === "saas"
      ? TRIAL_CONVERT_HINT_SAAS
      : TRIAL_CONVERT_HINT_LOCAL);
  return {
    ready: partial.ready,
    mechanism: partial.mechanism,
    modelId: partial.modelId ?? cfg.modelId,
    greeting,
    status: partial.status,
    expiresAt: partial.expiresAt ?? null,
    promptThreshold: cfg.promptThreshold,
    ttlDays: cfg.ttlDays,
    detail: partial.detail,
    primaryCtaLabel: partial.primaryCtaLabel ?? TRIAL_PRIMARY_CTA_LABEL,
    payGodModePath: partial.payGodModePath ?? TRIAL_PAY_GODMODE_PATH,
    payCtaLabel:
      partial.payCtaLabel ??
      (deploymentSurface === "saas"
        ? TRIAL_PAY_CTA_LABEL_SAAS
        : TRIAL_PAY_CTA_LABEL),
    deploymentSurface,
    convertHint,
    cloudSeatPath:
      partial.cloudSeatPath ??
      (deploymentSurface === "saas" ? TRIAL_CLOUD_SEAT_PATH : ""),
    cloudSeatCtaLabel:
      partial.cloudSeatCtaLabel ??
      (deploymentSurface === "saas" ? TRIAL_CLOUD_SEAT_CTA_LABEL : ""),
    affiliateSignupUrl: cfg.affiliateSignupUrl,
    personalSignupUrl: partial.personalSignupUrl ?? signup.url,
    signupInitiation: partial.signupInitiation ?? signup.initiation,
    signupEmail: partial.signupEmail ?? signup.email,
    openRouterUserName: partial.openRouterUserName ?? null,
    pasteKeyPath: partial.pasteKeyPath ?? TRIAL_PASTE_KEY_PATH,
    configured: {
      mgmtApi: Boolean(cfg.mgmtKey),
      platformShared: Boolean(cfg.platformKey),
      godmodeInferenceSupply: isGodModeInferenceSupplyReady(),
    },
    remainingOps: remainingOpsNote(cfg),
  };
}

function readActiveGrant(
  db: CoreDatabase,
  subject: string
): {
  mechanism: TrialProvisionMechanism;
  model_id: string;
  expires_at: string | null;
  status: string;
} | null {
  ensureTrialInferenceTables(db);
  const row = db
    .prepare(
      `SELECT mechanism, model_id, expires_at, status
       FROM trial_inference_grants WHERE subject_key=?`
    )
    .get(subject) as
    | {
        mechanism: TrialProvisionMechanism;
        model_id: string;
        expires_at: string | null;
        status: string;
      }
    | undefined;
  if (!row) return null;
  if (row.status !== "active") return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    db.prepare(
      `UPDATE trial_inference_grants SET status='expired', updated_at=datetime('now')
       WHERE subject_key=?`
    ).run(subject);
    return null;
  }
  return row;
}

function upsertGrant(
  db: CoreDatabase,
  opts: {
    subjectKey: string;
    userId?: string | null;
    visitorKey?: string | null;
    mechanism: TrialProvisionMechanism;
    modelId: string;
    expiresAt: string;
    providerKeyHash?: string | null;
    providerKeyId?: string | null;
    budgetUsd?: number;
  }
): void {
  ensureTrialInferenceTables(db);
  const id = randomUUID();
  const provider =
    opts.mechanism === "godmodeInferenceSupply" ? "godmode" : "openrouter";
  const budget =
    opts.budgetUsd ?? Math.max(0.01, defaultTrialBudgetUsd(db));
  db.prepare(
    `INSERT INTO trial_inference_grants (
       id, subject_key, user_id, visitor_key, provider, mechanism, status,
       kind, model_id, provider_key_hash, provider_key_id, expires_at,
       budget_usd, spent_usd, prompt_count
     ) VALUES (?, ?, ?, ?, ?, ?, 'active', 'trial', ?, ?, ?, ?, ?, 0, 0)
     ON CONFLICT(subject_key) DO UPDATE SET
       user_id=excluded.user_id,
       visitor_key=excluded.visitor_key,
       provider=excluded.provider,
       mechanism=excluded.mechanism,
       status='active',
       kind='trial',
       model_id=excluded.model_id,
       provider_key_hash=COALESCE(excluded.provider_key_hash, provider_key_hash),
       provider_key_id=COALESCE(excluded.provider_key_id, provider_key_id),
       expires_at=excluded.expires_at,
       budget_usd=COALESCE(excluded.budget_usd, budget_usd),
       updated_at=datetime('now')`
  ).run(
    id,
    opts.subjectKey,
    opts.userId ?? null,
    opts.visitorKey ?? null,
    provider,
    opts.mechanism,
    opts.modelId,
    opts.providerKeyHash ?? null,
    opts.providerKeyId ?? null,
    opts.expiresAt,
    budget
  );
}

/**
 * Ensure a spendable GodMode Inference intro grant when the user picks an
 * Admin supply model from the catalog (no personal Vault key).
 */
export function ensureGodModeInferenceIntroGrant(opts: {
  userId?: string | null;
  visitorKey?: string | null;
  modelId: string;
  db?: CoreDatabase;
}): void {
  const db = opts.db ?? getCloudDb();
  const existing = findActiveGodModeInferenceGrant({
    userId: opts.userId,
    visitorKey: opts.visitorKey,
    db,
  });
  if (isGrantSpendable(existing)) return;
  const cfg = trialInferenceConfig();
  const subject = subjectKeyFor({
    userId: opts.userId,
    visitorKey: opts.visitorKey,
  });
  const expiresAt = new Date(
    Date.now() + cfg.ttlDays * 24 * 60 * 60 * 1000
  ).toISOString();
  upsertGrant(db, {
    subjectKey: subject,
    userId: opts.userId,
    visitorKey: opts.visitorKey,
    mechanism: "godmodeInferenceSupply",
    modelId: opts.modelId,
    expiresAt,
    providerKeyHash: `godmode-inference-supply:intro`,
  });
}

async function mintOpenRouterKeyViaMgmtApi(opts: {
  name: string;
  limitUsd: number;
  expiresAt: string;
  mgmtKey: string;
  fetchImpl: typeof fetch;
}): Promise<{ key: string; hash?: string; id?: string }> {
  const res = await opts.fetchImpl("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.mgmtKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: opts.name,
      limit: opts.limitUsd,
      expires_at: opts.expiresAt,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { key?: string; hash?: string; id?: string };
    key?: string;
    hash?: string;
    id?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg =
      body.error?.message ||
      `OpenRouter Management API mint failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  const key = body.data?.key ?? body.key;
  if (!key) {
    throw Object.assign(
      new Error("OpenRouter Management API returned no key"),
      { status: 502 }
    );
  }
  return {
    key,
    hash: body.data?.hash ?? body.hash,
    id: body.data?.id ?? body.id,
  };
}

async function applyTrialToWorkspace(opts: {
  tenantDb: AppDatabase;
  apiKey: string;
  modelId: string;
  llm?: LlmManager | null;
}): Promise<void> {
  upsertOpenRouterApiKey(opts.tenantDb, opts.apiKey);
  markLlmReady(opts.tenantDb);
  if (opts.llm) {
    try {
      await selectIntelligenceModel(opts.tenantDb, opts.llm, {
        source: "provider",
        model: opts.modelId,
        provider: "openai_compatible",
        transport: "openrouter",
        baseUrl: OPENROUTER_API_BASE_URL,
      });
    } catch (err) {
      // Soft-fail model select: key is vaulted and llmReady is set; user can pick in UI.
      console.warn(
        "[trial-inference] selectIntelligenceModel soft-fail:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

/**
 * Attach Admin GodMode Inference supply to a workspace without copying keys
 * into the user's Platform Vault. Chat resolves keys from platform_meta / env.
 */
async function applyGodModeInferenceSupplyToWorkspace(opts: {
  tenantDb: AppDatabase;
  llm?: LlmManager | null;
}): Promise<{ modelId: string; provider: string } | null> {
  const target = pickGodModeInferenceSupplyTarget();
  if (!target) return null;
  markLlmReady(opts.tenantDb);
  if (opts.llm) {
    try {
      await selectIntelligenceModel(opts.tenantDb, opts.llm, {
        source: "provider",
        model: target.modelId,
        provider: "openai_compatible",
        transport: target.transport,
        baseUrl: target.baseUrl,
        apiKeyRef: target.apiKeyRef,
        managedGodModeInference: true,
      });
    } catch (err) {
      console.warn(
        "[trial-inference] GodMode Inference supply selectIntelligenceModel soft-fail:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return { modelId: target.modelId, provider: target.provider };
}

/**
 * When a grant already exists, still attach the shared platform key (or remint)
 * if this workspace Vault is missing OpenRouter. Prevents ready:true with
 * "No model ready" after workspace switch / fresh tenant DB.
 */
async function ensureWorkspaceHasTrialKey(opts: {
  tenantDb: AppDatabase;
  mechanism: TrialProvisionMechanism;
  modelId: string;
  llm?: LlmManager | null;
  platformKey: string;
  mgmtKey: string;
  userId?: string | null;
  visitorKey?: string | null;
  expiresAt: string;
  budgetUsd: number;
  fetchImpl: typeof fetch;
}): Promise<"attached" | "reminted" | "already" | "unavailable"> {
  if (opts.mechanism === "godmodeInferenceSupply") {
    const applied = await applyGodModeInferenceSupplyToWorkspace({
      tenantDb: opts.tenantDb,
      llm: opts.llm,
    });
    if (applied) return "already";
  }

  const vaultKey = getPlatformVaultSecretInScope(opts.tenantDb, {
    baseId: OPENROUTER_API_KEY_SECRET_ID,
    name: OPENROUTER_API_KEY_SECRET_NAME,
  });

  // Env-only readiness is not enough after a workspace switch: still copy the
  // platform shared key into this tenant Vault when missing.
  if (vaultKey) {
    if (opts.llm) {
      try {
        await selectIntelligenceModel(opts.tenantDb, opts.llm, {
          source: "provider",
          model: opts.modelId,
          provider: "openai_compatible",
          transport: "openrouter",
          baseUrl: OPENROUTER_API_BASE_URL,
        });
      } catch {
        /* soft-fail */
      }
    }
    markLlmReady(opts.tenantDb);
    return "already";
  }

  if (opts.mechanism === "platformShared" && opts.platformKey) {
    await applyTrialToWorkspace({
      tenantDb: opts.tenantDb,
      apiKey: opts.platformKey,
      modelId: opts.modelId,
      llm: opts.llm,
    });
    return "attached";
  }

  if (opts.mechanism === "mgmtApi" && opts.mgmtKey) {
    const minted = await mintOpenRouterKeyViaMgmtApi({
      name: `godmode-trial-${opts.userId ?? opts.visitorKey ?? "visitor"}`.slice(
        0,
        64
      ),
      limitUsd: opts.budgetUsd,
      expiresAt: opts.expiresAt,
      mgmtKey: opts.mgmtKey,
      fetchImpl: opts.fetchImpl,
    });
    await applyTrialToWorkspace({
      tenantDb: opts.tenantDb,
      apiKey: minted.key,
      modelId: opts.modelId,
      llm: opts.llm,
    });
    return "reminted";
  }

  if (opts.platformKey) {
    await applyTrialToWorkspace({
      tenantDb: opts.tenantDb,
      apiKey: opts.platformKey,
      modelId: opts.modelId,
      llm: opts.llm,
    });
    return "attached";
  }

  // Last resort: process env makes chat work without a Vault row (rare).
  if (isOpenRouterPlatformReady(opts.tenantDb)) {
    if (opts.llm) {
      try {
        await selectIntelligenceModel(opts.tenantDb, opts.llm, {
          source: "provider",
          model: opts.modelId,
          provider: "openai_compatible",
          transport: "openrouter",
          baseUrl: OPENROUTER_API_BASE_URL,
        });
      } catch {
        /* soft-fail */
      }
    }
    markLlmReady(opts.tenantDb);
    return "already";
  }

  return "unavailable";
}

/**
 * Probe or provision trial inference for a first-land visitor or signed-in user.
 * Does not scrape affiliate UIs. Management API mint requires a management key
 * (keys are minted under OUR OpenRouter account, not the user's personal account).
 * Platform shared key is the graceful fallback when configured.
 * Personal OpenRouter signup is browser deep-link only (no create-account API).
 */
export async function ensureTrialInference(
  opts: EnsureTrialInferenceOpts = {}
): Promise<TrialInferenceStatus> {
  const cfg = trialInferenceConfig();
  const db = opts.db ?? getCloudDb();
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const identity = resolveUserIdentity(db, opts);
  const subject = subjectKeyFor({
    userId: opts.userId,
    visitorKey: opts.visitorKey,
    clientIp: opts.clientIp,
  });
  const expiresAt = new Date(
    now.getTime() + cfg.ttlDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const existing = readActiveGrant(db, subject);
  if (existing) {
    if (!opts.tenantDb || opts.provision === false) {
      return baseStatus(
        {
          ready: true,
          mechanism: existing.mechanism,
          modelId: existing.model_id,
          status: "active",
          expiresAt: existing.expires_at,
          detail:
            "Existing GodMode Inference trial grant reused. Keep chatting; when free runs out, pay through GodMode.",
        },
        identity
      );
    }

    try {
      // Supply grant exists but agent still on Cursor (soft-fail attach / prior default).
      // Re-apply Admin GodMode Inference so intros use platform keys.
      if (
        existing.mechanism === "godmodeInferenceSupply" &&
        isGodModeInferenceSupplyReady() &&
        opts.llm
      ) {
        const agent = getAgent(opts.tenantDb, "intelligence");
        if (agent?.backend === "cursor_cloud") {
          const applied = await applyGodModeInferenceSupplyToWorkspace({
            tenantDb: opts.tenantDb,
            llm: opts.llm,
          });
          if (applied) {
            upsertGrant(db, {
              subjectKey: subject,
              userId: opts.userId,
              visitorKey: opts.visitorKey,
              mechanism: "godmodeInferenceSupply",
              modelId: applied.modelId,
              expiresAt,
              providerKeyHash: hashTrialSecret(
                `godmode-inference-supply:${applied.provider}`
              ),
            });
            return baseStatus(
              {
                ready: true,
                mechanism: "godmodeInferenceSupply",
                modelId: applied.modelId,
                status: "active",
                expiresAt,
                detail:
                  "Attached Admin GodMode Inference supply for Intelligence intros (no personal Vault key required). Keep chatting; when ready, add your own BYOK in Platform Vault.",
              },
              identity
            );
          }
        }
      }

      const attach = await ensureWorkspaceHasTrialKey({
        tenantDb: opts.tenantDb,
        mechanism: existing.mechanism,
        modelId: existing.model_id || cfg.modelId,
        llm: opts.llm,
        platformKey: cfg.platformKey,
        mgmtKey: cfg.mgmtKey,
        userId: opts.userId,
        visitorKey: opts.visitorKey,
        expiresAt,
        budgetUsd: cfg.budgetUsd,
        fetchImpl,
      });

      if (attach === "unavailable") {
        // Fall through to fresh provision when we cannot recover the key.
      } else {
        if (attach === "reminted") {
          upsertGrant(db, {
            subjectKey: subject,
            userId: opts.userId,
            visitorKey: opts.visitorKey,
            mechanism: "mgmtApi",
            modelId: cfg.modelId,
            expiresAt,
            providerKeyHash: hashTrialSecret(`reminted:${expiresAt}`),
          });
        }
        return baseStatus(
          {
            ready: true,
            mechanism:
              attach === "reminted" ? "mgmtApi" : existing.mechanism,
            modelId:
              attach === "reminted" ? cfg.modelId : existing.model_id,
            status: "active",
            expiresAt: attach === "reminted" ? expiresAt : existing.expires_at,
            detail:
              attach === "attached"
                ? "Re-attached GodMode Inference trial key to workspace Vault. Keep chatting; when free runs out, pay through GodMode."
                : attach === "reminted"
                  ? "Re-minted GodMode Inference trial key for this workspace. Keep chatting; when free runs out, pay through GodMode."
                  : "Existing GodMode Inference trial grant reused. Keep chatting; when free runs out, pay through GodMode.",
          },
          identity
        );
      }
    } catch (err) {
      if (
        cfg.platformKey ||
        isGodModeInferenceSupplyReady() ||
        isOpenRouterPlatformReady(opts.tenantDb)
      ) {
        return baseStatus(
          {
            ready: true,
            mechanism: existing.mechanism,
            modelId: existing.model_id,
            status: "active",
            expiresAt: existing.expires_at,
            detail:
              err instanceof Error
                ? err.message
                : "Trial grant present; workspace attach soft-failed.",
          },
          identity
        );
      }
      // Fall through to provision loop.
    }
  }

  const provision = opts.provision !== false;
  const canMintForSubject = Boolean(opts.userId) || cfg.allowVisitorMint;

  if (!cfg.mgmtKey && !cfg.platformKey && !isGodModeInferenceSupplyReady()) {
    return baseStatus(
      {
        ready: false,
        mechanism: "none",
        status: "unconfigured",
        detail:
          "GodMode Inference is not configured. Set Admin → GodMode Inference (DeepSeek / Z.AI / Qwen), and/or OPENROUTER_MANAGEMENT_API_KEY / TRIAL_PLATFORM_API_KEY. See GitHub #758.",
      },
      identity
    );
  }

  // Pre-auth visitors: report readiness without minting orphan keys
  // (unless TRIAL_ALLOW_VISITOR_MINT=true). Respect TRIAL_PROVISION_ORDER.
  if (!opts.userId && !cfg.allowVisitorMint) {
    const visitorMechanism = cfg.order.find((m) => {
      if (m === "godmodeInferenceSupply") return isGodModeInferenceSupplyReady();
      if (m === "platformShared") return Boolean(cfg.platformKey);
      if (m === "mgmtApi") return Boolean(cfg.mgmtKey);
      return false;
    }) as TrialProvisionMechanism | undefined;
    if (
      visitorMechanism === "godmodeInferenceSupply" ||
      visitorMechanism === "platformShared"
    ) {
      return baseStatus(
        {
          ready: true,
          mechanism: visitorMechanism,
          status: "deferred_until_auth",
          expiresAt,
          detail:
            visitorMechanism === "godmodeInferenceSupply"
              ? "Platform GodMode Inference supply is configured. Sign in so GodMode can attach Inference to your workspace and select a guide model."
              : "Platform GodMode Inference key is configured. Sign in so GodMode can attach Inference to your workspace Vault and select a guide model.",
        },
        identity
      );
    }
    return baseStatus(
      {
        ready: false,
        mechanism: "mgmtApi",
        status: "deferred_until_auth",
        detail:
          "Management API mint waits for a signed-in GodMode user. Greeting still shows client-side.",
      },
      identity
    );
  }

  if (!provision) {
    return baseStatus(
      {
        ready: Boolean(
          isGodModeInferenceSupplyReady() ||
            cfg.platformKey ||
            (cfg.mgmtKey && canMintForSubject)
        ),
        mechanism: isGodModeInferenceSupplyReady()
          ? "godmodeInferenceSupply"
          : cfg.mgmtKey
            ? "mgmtApi"
            : "platformShared",
        status:
          isGodModeInferenceSupplyReady() || cfg.platformKey || cfg.mgmtKey
            ? "deferred_until_auth"
            : "unconfigured",
        detail: "Provision skipped (status probe only).",
      },
      identity
    );
  }

  let lastError: string | undefined;

  for (const mechanism of cfg.order) {
    if (mechanism === "browser" || mechanism === "computerUse" || mechanism === "terminal") {
      // Scaffold only: do not scrape or drive affiliate UIs in this slice.
      lastError = `${mechanism} provisioner is deferred (GitHub #758).`;
      continue;
    }

    if (mechanism === "godmodeInferenceSupply") {
      if (!isGodModeInferenceSupplyReady()) continue;
      if (!opts.tenantDb) {
        return baseStatus(
          {
            ready: true,
            mechanism: "godmodeInferenceSupply",
            status: "deferred_until_auth",
            expiresAt,
            detail:
              "Admin GodMode Inference supply is ready. Sign in to attach it to a workspace.",
          },
          identity
        );
      }
      try {
        const applied = await applyGodModeInferenceSupplyToWorkspace({
          tenantDb: opts.tenantDb,
          llm: opts.llm,
        });
        if (!applied) continue;
        upsertGrant(db, {
          subjectKey: subject,
          userId: opts.userId,
          visitorKey: opts.visitorKey,
          mechanism: "godmodeInferenceSupply",
          modelId: applied.modelId,
          expiresAt,
          providerKeyHash: hashTrialSecret(
            `godmode-inference-supply:${applied.provider}`
          ),
        });
        return baseStatus(
          {
            ready: true,
            mechanism: "godmodeInferenceSupply",
            modelId: applied.modelId,
            status: "active",
            expiresAt,
            detail:
              "Attached Admin GodMode Inference supply for signup-guide onboarding (no personal Vault key required). Keep chatting; when ready, add your own BYOK in Platform Vault.",
          },
          identity
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }
    }

    if (mechanism === "mgmtApi") {
      if (!cfg.mgmtKey || !canMintForSubject) continue;
      try {
        const minted = await mintOpenRouterKeyViaMgmtApi({
          name: `godmode-trial-${opts.userId ?? opts.visitorKey ?? "visitor"}`.slice(
            0,
            64
          ),
          limitUsd: cfg.budgetUsd,
          expiresAt,
          mgmtKey: cfg.mgmtKey,
          fetchImpl,
        });
        if (opts.tenantDb) {
          await applyTrialToWorkspace({
            tenantDb: opts.tenantDb,
            apiKey: minted.key,
            modelId: cfg.modelId,
            llm: opts.llm,
          });
        }
        upsertGrant(db, {
          subjectKey: subject,
          userId: opts.userId,
          visitorKey: opts.visitorKey,
          mechanism: "mgmtApi",
          modelId: cfg.modelId,
          expiresAt,
          providerKeyHash: minted.hash ?? hashTrialSecret(minted.key),
          providerKeyId: minted.id ?? null,
        });
        return baseStatus(
          {
            ready: true,
            mechanism: "mgmtApi",
            status: "active",
            expiresAt,
            detail:
              "Minted GodMode Inference trial key via OpenRouter Management API under our platform account. Keep chatting; when free runs out, pay through GodMode. Personal OpenRouter key remains advanced BYOK.",
          },
          identity
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }
    }

    if (mechanism === "platformShared") {
      if (!cfg.platformKey) continue;
      if (opts.tenantDb) {
        await applyTrialToWorkspace({
          tenantDb: opts.tenantDb,
          apiKey: cfg.platformKey,
          modelId: cfg.modelId,
          llm: opts.llm,
        });
      }
      upsertGrant(db, {
        subjectKey: subject,
        userId: opts.userId,
        visitorKey: opts.visitorKey,
        mechanism: "platformShared",
        modelId: cfg.modelId,
        expiresAt,
        providerKeyHash: hashTrialSecret(cfg.platformKey),
      });
      return baseStatus(
        {
          ready: true,
          mechanism: "platformShared",
          status: "active",
          expiresAt,
          detail:
            "Attached platform shared GodMode Inference trial key to workspace Vault. Keep chatting; when free runs out, pay through GodMode. Personal OpenRouter key remains advanced BYOK.",
        },
        identity
      );
    }
  }

  return baseStatus(
    {
      ready: false,
      mechanism: "none",
      status: "failed",
      detail:
        lastError ||
        "No trial provision mechanism succeeded. Soft-fail to Vault Connect / FirstRunWizard.",
    },
    identity
  );
}

/** Read-only status for UI (no side effects beyond schema ensure). */
export function getTrialInferenceStatus(
  opts: EnsureTrialInferenceOpts = {}
): TrialInferenceStatus {
  const cfg = trialInferenceConfig();
  const db = opts.db ?? getCloudDb();
  const identity = resolveUserIdentity(db, opts);
  const subject = subjectKeyFor({
    userId: opts.userId,
    visitorKey: opts.visitorKey,
    clientIp: opts.clientIp,
  });
  const existing = readActiveGrant(db, subject);
  if (existing) {
    return baseStatus(
      {
        ready: true,
        mechanism: existing.mechanism,
        modelId: existing.model_id,
        status: "active",
        expiresAt: existing.expires_at,
      },
      identity
    );
  }
  if (!cfg.mgmtKey && !cfg.platformKey) {
    return baseStatus(
      {
        ready: false,
        mechanism: "none",
        status: "unconfigured",
        detail:
          "Trial inference is not configured. Greeting still displays; chat needs Vault Connect or trial env.",
      },
      identity
    );
  }
  if (!opts.userId) {
    return baseStatus(
      {
        ready: Boolean(cfg.platformKey),
        mechanism: cfg.platformKey ? "platformShared" : "mgmtApi",
        status: "deferred_until_auth",
        detail: cfg.platformKey
          ? "Platform trial key present; full attach after sign-in."
          : "Sign in to mint a per-user trial key.",
      },
      identity
    );
  }
  return baseStatus(
    {
      ready: false,
      mechanism: cfg.mgmtKey ? "mgmtApi" : "platformShared",
      status: "unconfigured",
      detail: "Call POST /api/trial-inference/ensure to provision.",
    },
    identity
  );
}
