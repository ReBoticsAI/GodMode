import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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
  throw new Error(
    `Bundled Node runtime missing at ${bundled}. Reinstall GodMode.`
  );
}

export function ensureRuntimeDependencies(runtime: string): void {
  const modules = path.join(runtime, "node_modules");
  const staged = path.join(runtime, "_node_modules");
  if (!fs.existsSync(modules) && fs.existsSync(staged)) {
    try {
      fs.renameSync(staged, modules);
    } catch (error) {
      // Windows Defender / indexer sometimes blocks rename; junction is enough.
      const linked = spawnSync(
        "cmd.exe",
        ["/c", `mklink /J "${modules}" "${staged}"`],
        { encoding: "utf8" }
      );
      if (linked.status !== 0 || !fs.existsSync(modules)) {
        throw new Error(
          `Unable to expose runtime dependencies at ${modules}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }
  const cors = path.join(modules, "cors");
  if (!fs.existsSync(cors)) {
    throw new Error(
      `Desktop runtime is missing dependencies (cors). ` +
        `Expected packages under ${modules}. Reinstall from a newer GitHub release.`
    );
  }
}

export function openLogFile(userData: string): string {
  const dir = path.join(userData, "logs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "desktop.log");
  fs.writeFileSync(
    file,
    `\n---- GodMode desktop ${new Date().toISOString()} ----\n`,
    { flag: "a" }
  );
  return file;
}

export function appendLog(logFile: string | null, message: string): void {
  if (!logFile) {
    console.error(message);
    return;
  }
  try {
    fs.appendFileSync(logFile, `${message}\n`);
  } catch {
    console.error(message);
  }
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
      // Require a real success — 404 means static assets are missing.
      if (response.ok || response.status === 401) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
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

function spawnLogged(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    logFile: string | null;
    label: string;
  }
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const forward = (chunk: Buffer, stream: "stdout" | "stderr") => {
    const text = chunk.toString("utf8").trimEnd();
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      appendLog(options.logFile, `[${options.label}:${stream}] ${line}`);
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => forward(chunk, "stdout"));
  child.stderr?.on("data", (chunk: Buffer) => forward(chunk, "stderr"));
  return child;
}

export function spawnHost(options: {
  runtime: string;
  env: NodeJS.ProcessEnv;
  logFile: string | null;
}): ChildProcess {
  const node = nodeBinary(options.runtime);
  const hostScript = path.join(options.runtime, "bin", "host.mjs");
  if (!fs.existsSync(hostScript)) {
    throw new Error(`Missing host runtime at ${hostScript}`);
  }
  return spawnLogged(node, [hostScript], {
    cwd: options.runtime,
    env: options.env,
    logFile: options.logFile,
    label: "host",
  });
}

export function spawnSupervisor(options: {
  updateRoot: string;
  env: NodeJS.ProcessEnv;
  logFile: string | null;
}): ChildProcess {
  const node = options.env.GODMODE_NODE_BIN;
  if (!node) throw new Error("GODMODE_NODE_BIN is required for the supervisor");
  const script = path.join(options.updateRoot, "supervisor.mjs");
  if (!fs.existsSync(script)) {
    throw new Error(`Missing update supervisor at ${script}`);
  }
  return spawnLogged(node, [script], {
    cwd: options.updateRoot,
    env: options.env,
    logFile: options.logFile,
    label: "supervisor",
  });
}

export { __dirname as desktopDistDir };
