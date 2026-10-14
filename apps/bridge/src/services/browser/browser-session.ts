/**
 * Local Browser stage runtime: Bridge-supervised Playwright Chromium with a
 * dedicated user-data-dir under GodMode data. Not Docker/Firecracker.
 * Part of #850 / #374.
 */
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../../config.js";
import { browserStageAllowed, browserStageDeniedMessage } from "./browser-access.js";

export type BrowserSessionMode = "agent" | "paused" | "human";

export type BrowserSessionPublic = {
  id: string;
  agentId: string;
  tenantId: string;
  url: string;
  title: string;
  mode: BrowserSessionMode;
  stepCount: number;
  maxSteps: number;
  allowHosts: string[];
  createdAt: string;
  updatedAt: string;
  profileDir: string;
};

type FrameListener = (frame: {
  sessionId: string;
  mimeType: string;
  dataBase64: string;
  url: string;
}) => void;

type SessionInternal = {
  public: BrowserSessionPublic;
  browser: import("playwright").Browser | null;
  context: import("playwright").BrowserContext | null;
  page: import("playwright").Page | null;
  lastFrameBase64: string | null;
  lastFrameMime: string;
  frameListeners: Set<FrameListener>;
  screencastStarted: boolean;
};

const sessions = new Map<string, SessionInternal>();
let chromiumEnsurePromise: Promise<void> | null = null;

const DEFAULT_MAX_STEPS = 80;

function profilesRoot(): string {
  return path.join(config.dataDir, "browser-profiles");
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when allowHosts is empty or url host matches an entry / subdomain. */
export function hostAllowed(url: string, allowHosts: string[]): boolean {
  if (allowHosts.length === 0) return true;
  const host = hostOf(url);
  if (!host) return false;
  return allowHosts.some(
    (h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`)
  );
}

function assertAllowed(): void {
  if (!browserStageAllowed()) {
    throw new BrowserSessionError(browserStageDeniedMessage(), 403);
  }
}

export class BrowserSessionError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "BrowserSessionError";
  }
}

async function ensureChromium(): Promise<void> {
  if (chromiumEnsurePromise) return chromiumEnsurePromise;
  chromiumEnsurePromise = (async () => {
    const { chromium } = await import("playwright");
    const exe = chromium.executablePath();
    if (exe && fs.existsSync(exe)) return;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { createRequire } = await import("node:module");
    const execFileAsync = promisify(execFile);
    const require = createRequire(import.meta.url);
    let pkgJson: string;
    try {
      pkgJson = require.resolve("playwright/package.json");
    } catch {
      pkgJson = path.join(
        config.repoRoot,
        "node_modules",
        "playwright",
        "package.json"
      );
    }
    const cli = path.join(path.dirname(pkgJson), "cli.js");
    await execFileAsync(process.execPath, [cli, "install", "chromium"], {
      env: process.env,
      timeout: 10 * 60 * 1000,
    });
  })().catch((err) => {
    chromiumEnsurePromise = null;
    throw err;
  });
  return chromiumEnsurePromise;
}

function touch(s: SessionInternal): void {
  s.public.updatedAt = new Date().toISOString();
}

async function refreshMeta(s: SessionInternal): Promise<void> {
  if (!s.page) return;
  try {
    s.public.url = s.page.url();
    s.public.title = await s.page.title();
  } catch {
    /* page may be mid-nav */
  }
  touch(s);
}

function assertModeAllowsAgent(s: SessionInternal): void {
  if (s.public.mode === "human") {
    throw new BrowserSessionError(
      "Session is in human take-over. Call browser_session_resume before agent actions.",
      409
    );
  }
  if (s.public.mode === "paused") {
    throw new BrowserSessionError(
      "Session is paused. Call browser_session_resume before agent actions.",
      409
    );
  }
}

function assertStepBudget(s: SessionInternal): void {
  if (s.public.stepCount >= s.public.maxSteps) {
    throw new BrowserSessionError(
      `Browser session hit maxSteps (${s.public.maxSteps}). Close and start a new session.`,
      429
    );
  }
}

function assertHostAllowed(s: SessionInternal, url: string): void {
  if (!hostOf(url)) {
    throw new BrowserSessionError(`Invalid URL: ${url}`);
  }
  if (!hostAllowed(url, s.public.allowHosts)) {
    const host = hostOf(url);
    throw new BrowserSessionError(
      `Host "${host}" is not on the session allowlist (${s.public.allowHosts.join(", ")}).`,
      403
    );
  }
}

async function captureFrame(s: SessionInternal): Promise<void> {
  if (!s.page) return;
  try {
    const buf = await s.page.screenshot({ type: "jpeg", quality: 55 });
    s.lastFrameBase64 = buf.toString("base64");
    s.lastFrameMime = "image/jpeg";
    const payload = {
      sessionId: s.public.id,
      mimeType: s.lastFrameMime,
      dataBase64: s.lastFrameBase64,
      url: s.public.url,
    };
    for (const listener of s.frameListeners) {
      try {
        listener(payload);
      } catch {
        /* ignore listener errors */
      }
    }
  } catch {
    /* ignore screenshot failures during nav */
  }
}

export function listBrowserSessions(filter?: {
  tenantId?: string;
  agentId?: string;
}): BrowserSessionPublic[] {
  return [...sessions.values()]
    .filter((s) => {
      if (filter?.tenantId && s.public.tenantId !== filter.tenantId) return false;
      if (filter?.agentId && s.public.agentId !== filter.agentId) return false;
      return true;
    })
    .map((s) => ({ ...s.public }));
}

export function getBrowserSession(sessionId: string): BrowserSessionPublic | null {
  const s = sessions.get(sessionId);
  return s ? { ...s.public } : null;
}

export function getBrowserSessionFrame(sessionId: string): {
  mimeType: string;
  dataBase64: string;
  url: string;
} | null {
  const s = sessions.get(sessionId);
  if (!s?.lastFrameBase64) return null;
  return {
    mimeType: s.lastFrameMime,
    dataBase64: s.lastFrameBase64,
    url: s.public.url,
  };
}

export function subscribeBrowserFrames(
  sessionId: string,
  listener: FrameListener
): () => void {
  const s = sessions.get(sessionId);
  if (!s) throw new BrowserSessionError(`Unknown browser session: ${sessionId}`, 404);
  s.frameListeners.add(listener);
  return () => {
    s.frameListeners.delete(listener);
  };
}

export async function createBrowserSession(opts: {
  agentId: string;
  tenantId: string;
  url?: string;
  allowHosts?: string[];
  maxSteps?: number;
  headless?: boolean;
}): Promise<BrowserSessionPublic> {
  assertAllowed();
  await ensureChromium();
  const { chromium } = await import("playwright");

  const id = uuidv4();
  const profileDir = path.join(profilesRoot(), id);
  fs.mkdirSync(profileDir, { recursive: true });

  const allowHosts = (opts.allowHosts ?? [])
    .map((h) => String(h).trim().toLowerCase())
    .filter(Boolean);
  const maxSteps = Math.min(
    Math.max(Number(opts.maxSteps ?? DEFAULT_MAX_STEPS) || DEFAULT_MAX_STEPS, 1),
    500
  );

  const headless =
    opts.headless ?? process.env.PLATFORM_BROWSER_HEADLESS !== "0";

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1280, height: 720 },
    args: ["--disable-dev-shm-usage"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const browser = context.browser();

  const now = new Date().toISOString();
  const internal: SessionInternal = {
    public: {
      id,
      agentId: opts.agentId,
      tenantId: opts.tenantId,
      url: "about:blank",
      title: "",
      mode: "agent",
      stepCount: 0,
      maxSteps,
      allowHosts,
      createdAt: now,
      updatedAt: now,
      profileDir,
    },
    browser,
    context,
    page,
    lastFrameBase64: null,
    lastFrameMime: "image/jpeg",
    frameListeners: new Set(),
    screencastStarted: false,
  };
  sessions.set(id, internal);

  page.on("framenavigated", () => {
    void refreshMeta(internal).then(() => captureFrame(internal));
  });

  if (opts.url) {
    await browserNavigate(id, opts.url);
  } else {
    await captureFrame(internal);
  }

  return { ...internal.public };
}

function requireSession(sessionId: string): SessionInternal {
  const s = sessions.get(sessionId);
  if (!s) throw new BrowserSessionError(`Unknown browser session: ${sessionId}`, 404);
  return s;
}

export async function closeBrowserSession(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  try {
    await s.context?.close();
  } catch {
    /* ignore */
  }
  try {
    await s.browser?.close();
  } catch {
    /* ignore */
  }
}

export function setBrowserSessionMode(
  sessionId: string,
  mode: BrowserSessionMode
): BrowserSessionPublic {
  const s = requireSession(sessionId);
  s.public.mode = mode;
  touch(s);
  return { ...s.public };
}

export async function browserNavigate(
  sessionId: string,
  url: string
): Promise<BrowserSessionPublic> {
  assertAllowed();
  const s = requireSession(sessionId);
  assertModeAllowsAgent(s);
  assertStepBudget(s);
  const trimmed = String(url ?? "").trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    throw new BrowserSessionError("Valid http(s) url required");
  }
  assertHostAllowed(s, trimmed);
  s.public.stepCount += 1;
  await s.page!.goto(trimmed, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await refreshMeta(s);
  await captureFrame(s);
  return { ...s.public };
}

export async function browserClick(
  sessionId: string,
  selector: string
): Promise<BrowserSessionPublic> {
  assertAllowed();
  const s = requireSession(sessionId);
  assertModeAllowsAgent(s);
  assertStepBudget(s);
  const sel = String(selector ?? "").trim();
  if (!sel) throw new BrowserSessionError("selector required");
  s.public.stepCount += 1;
  await s.page!.click(sel, { timeout: 30_000 });
  await refreshMeta(s);
  await captureFrame(s);
  return { ...s.public };
}

export async function browserType(
  sessionId: string,
  selector: string,
  text: string,
  opts?: { clear?: boolean; pressEnter?: boolean }
): Promise<BrowserSessionPublic> {
  assertAllowed();
  const s = requireSession(sessionId);
  assertModeAllowsAgent(s);
  assertStepBudget(s);
  const sel = String(selector ?? "").trim();
  if (!sel) throw new BrowserSessionError("selector required");
  s.public.stepCount += 1;
  if (opts?.clear) {
    await s.page!.fill(sel, String(text ?? ""), { timeout: 30_000 });
  } else {
    await s.page!.click(sel, { timeout: 30_000 });
    await s.page!.keyboard.type(String(text ?? ""), { delay: 15 });
  }
  if (opts?.pressEnter) {
    await s.page!.keyboard.press("Enter");
  }
  await refreshMeta(s);
  await captureFrame(s);
  return { ...s.public };
}

export async function browserSelect(
  sessionId: string,
  selector: string,
  value: string
): Promise<BrowserSessionPublic> {
  assertAllowed();
  const s = requireSession(sessionId);
  assertModeAllowsAgent(s);
  assertStepBudget(s);
  const sel = String(selector ?? "").trim();
  if (!sel) throw new BrowserSessionError("selector required");
  s.public.stepCount += 1;
  await s.page!.selectOption(sel, String(value ?? ""), { timeout: 30_000 });
  await refreshMeta(s);
  await captureFrame(s);
  return { ...s.public };
}

export async function browserScreenshot(
  sessionId: string
): Promise<{ mimeType: string; dataBase64: string; url: string }> {
  assertAllowed();
  const s = requireSession(sessionId);
  await captureFrame(s);
  if (!s.lastFrameBase64) {
    throw new BrowserSessionError("Failed to capture screenshot", 500);
  }
  return {
    mimeType: s.lastFrameMime,
    dataBase64: s.lastFrameBase64,
    url: s.public.url,
  };
}

export async function browserSnapshot(sessionId: string): Promise<{
  url: string;
  title: string;
  snapshot: string;
}> {
  assertAllowed();
  const s = requireSession(sessionId);
  await refreshMeta(s);
  // Prefer accessibility tree; fall back to truncated HTML.
  let snapshot = "";
  try {
    const tree = await s.page!.accessibility.snapshot({ interestingOnly: true });
    snapshot = JSON.stringify(tree, null, 2).slice(0, 40_000);
  } catch {
    const html = await s.page!.content();
    snapshot = html.slice(0, 40_000);
  }
  return {
    url: s.public.url,
    title: s.public.title,
    snapshot,
  };
}

/** Test helper: clear all sessions (closes browsers). */
export async function _resetBrowserSessionsForTests(): Promise<void> {
  const ids = [...sessions.keys()];
  for (const id of ids) {
    await closeBrowserSession(id);
  }
}
