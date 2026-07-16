import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SMOKE_TIMEOUT_MS = 8 * 60_000;
const archive = path.resolve(process.argv[2] ?? "");
if (!archive) throw new Error("Usage: smoke-bare-metal.mjs <bundle-archive>");

const temporary = await mkdtemp(path.join(os.tmpdir(), "godmode-bare-smoke-"));
const extracted = path.join(temporary, "extracted");
await import("node:fs/promises").then(({ mkdir }) => mkdir(extracted));

// Prefer tar on all platforms (including Windows zip); Expand-Archive is too slow
// for full node_modules bundles and burned the previous 3-minute CI step budget.
const unpack = spawnSync("tar", ["-xf", archive, "-C", extracted], {
  stdio: "inherit",
});
if (unpack.status !== 0) throw new Error("Unable to extract bare-metal bundle");

const roots = await readdir(extracted, { withFileTypes: true });
const root = path.join(
  extracted,
  roots.find((entry) => entry.isDirectory())?.name ??
    (() => {
      throw new Error("Bundle has no runtime directory");
    })()
);
const node = path.join(root, "bin", process.platform === "win32" ? "node.exe" : "node");
const host = path.join(root, "bin", "host.mjs");

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

async function waitForHealth(url, child, deadline) {
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Bare-metal runtime exited with ${child.exitCode}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) return;
    } catch {
      // Continue bounded startup polling.
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Bare-metal runtime did not become healthy");
}

const child = spawn(node, [host], {
  cwd: root,
  env: {
    ...process.env,
    PLATFORM_DATA_DIR: path.join(temporary, "data"),
    GODMODE_HOST: "127.0.0.1",
    GODMODE_PORT: "18081",
    BRIDGE_PORT: "13947",
    AUTH_ALLOW_ANONYMOUS: "true",
    AUTH_SESSION_SECRET: "smoke-test-session-secret-not-for-production",
    UPDATE_CHANNEL: "stable",
  },
  stdio: "inherit",
  detached: process.platform !== "win32",
  windowsHide: true,
});

const deadline = Date.now() + SMOKE_TIMEOUT_MS;
try {
  await waitForHealth("http://127.0.0.1:18081/api/health", child, deadline);
  console.log(`Bare-metal startup smoke passed: ${path.basename(archive)}`);
} finally {
  killTree(child);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
}
