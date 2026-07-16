import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function freePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a free port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

export function supervisorToken(): string {
  return randomBytes(24).toString("hex");
}

export function runtimeRoot(isPackaged: boolean, appPath: string): string {
  if (isPackaged) {
    return path.join(process.resourcesPath, "runtime");
  }
  const staged = path.join(appPath, "resources", "runtime");
  if (fs.existsSync(path.join(staged, "bin", "host.mjs"))) return staged;
  // Dev fallback: monorepo root when resources/runtime is not staged yet.
  return path.resolve(appPath, "..", "..");
}

export function updateScriptsRoot(isPackaged: boolean, appPath: string): string {
  if (isPackaged) return path.join(process.resourcesPath, "update");
  const staged = path.join(appPath, "resources", "update");
  if (fs.existsSync(path.join(staged, "supervisor.mjs"))) return staged;
  return path.resolve(appPath, "..", "..", "scripts", "update");
}

export function nodeBinary(runtime: string): string {
  const name = process.platform === "win32" ? "node.exe" : "node";
  const bundled = path.join(runtime, "bin", name);
  if (fs.existsSync(bundled)) return bundled;
  return process.execPath;
}

export async function waitForUrl(
  url: string,
  timeoutMs = 60_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok || response.status === 401 || response.status === 404) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

export function spawnHost(options: {
  runtime: string;
  env: NodeJS.ProcessEnv;
}): ChildProcess {
  const node = nodeBinary(options.runtime);
  const hostScript = path.join(options.runtime, "bin", "host.mjs");
  if (!fs.existsSync(hostScript)) {
    throw new Error(`Missing host runtime at ${hostScript}`);
  }
  return spawn(node, [hostScript], {
    cwd: options.runtime,
    env: options.env,
    stdio: "inherit",
    windowsHide: true,
  });
}

export function spawnSupervisor(options: {
  updateRoot: string;
  env: NodeJS.ProcessEnv;
}): ChildProcess {
  const node = options.env.GODMODE_NODE_BIN || process.execPath;
  const script = path.join(options.updateRoot, "supervisor.mjs");
  if (!fs.existsSync(script)) {
    throw new Error(`Missing update supervisor at ${script}`);
  }
  return spawn(node, [script], {
    cwd: options.updateRoot,
    env: options.env,
    stdio: "inherit",
    windowsHide: true,
  });
}

export { __dirname as desktopDistDir };
