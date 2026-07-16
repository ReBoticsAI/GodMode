import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const archive = path.resolve(process.argv[2] ?? "");
if (!archive) throw new Error("Usage: smoke-bare-metal.mjs <bundle-archive>");
const temporary = await mkdtemp(path.join(os.tmpdir(), "godmode-bare-smoke-"));
const extracted = path.join(temporary, "extracted");
await import("node:fs/promises").then(({ mkdir }) => mkdir(extracted));
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
const child = spawn(node, [host], {
  cwd: root,
  env: {
    ...process.env,
    PLATFORM_DATA_DIR: path.join(temporary, "data"),
    GODMODE_HOST: "127.0.0.1",
    GODMODE_PORT: "18081",
    BRIDGE_PORT: "13947",
    AUTH_ALLOW_ANONYMOUS: "true",
    UPDATE_CHANNEL: "stable",
  },
  stdio: "inherit",
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Bare-metal runtime exited with ${child.exitCode}`);
    }
    try {
      const response = await fetch("http://127.0.0.1:18081/api/health", {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Continue bounded startup polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!ready) throw new Error("Bare-metal runtime did not become healthy");
  console.log(`Bare-metal startup smoke passed: ${path.basename(archive)}`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await rm(temporary, { recursive: true, force: true });
}
