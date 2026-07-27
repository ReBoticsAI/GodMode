/**
 * Docker network helpers for kernel-enforced Layer 4 build egress (#170).
 * Allowlisted builds use an --internal bridge: no route to the public internet;
 * only host.docker.internal (CONNECT proxy on the host) remains reachable.
 */
import { spawn } from "node:child_process";

export const DEFAULT_BUILD_EGRESS_NETWORK = "godmode-build-egress";

export function resolveBuildEgressNetworkName() {
  const fromEnv = String(process.env.CODING_BUILD_EGRESS_NETWORK || "").trim();
  return fromEnv || DEFAULT_BUILD_EGRESS_NETWORK;
}

/**
 * Build `docker run` argv (without the leading `run`).
 * Exported for unit tests.
 */
export function buildDockerRunArgs(opts) {
  const args = ["--rm"];
  if (opts.network === "none") {
    args.push("--network", "none");
  } else if (opts.network === "allowlist") {
    if (!opts.networkName) {
      throw new Error("allowlist builds require an internal Docker network name");
    }
    if (opts.proxyPort == null || !Number.isFinite(Number(opts.proxyPort))) {
      throw new Error("allowlist builds require a CONNECT proxy port");
    }
    // --internal network: no masquerade to the internet; host gateway still works.
    args.push("--network", opts.networkName);
    args.push("--add-host", "host.docker.internal:host-gateway");
    const proxyUrl = `http://host.docker.internal:${opts.proxyPort}`;
    args.push(
      "-e",
      `HTTP_PROXY=${proxyUrl}`,
      "-e",
      `HTTPS_PROXY=${proxyUrl}`,
      "-e",
      `http_proxy=${proxyUrl}`,
      "-e",
      `https_proxy=${proxyUrl}`,
      "-e",
      "NO_PROXY=localhost,127.0.0.1",
      "-e",
      "no_proxy=localhost,127.0.0.1",
      "-e",
      `npm_config_proxy=${proxyUrl}`,
      "-e",
      `npm_config_https_proxy=${proxyUrl}`
    );
  } else {
    throw new Error(`Unsupported docker network mode: ${opts.network}`);
  }

  args.push(
    "-v",
    `${opts.bindHost}:/workspace:rw`,
    "-w",
    opts.workdir,
    opts.image,
    ...opts.argv
  );
  return args;
}

function runDockerCli(dockerBin, argv, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const child = spawn(dockerBin, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve({
        code: 124,
        stdout,
        stderr: `${stderr}\ndocker CLI timed out`.trim(),
      });
    }, timeoutMs);
    child.stdout.on("data", (c) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Ensure a Docker network exists with Internal=true.
 * Fail closed if a same-named non-internal network already exists.
 *
 * @returns {Promise<{ name: string, created: boolean, internal: boolean }>}
 */
export async function ensureInternalBuildNetwork(opts = {}) {
  const dockerBin = opts.dockerBin || process.env.DOCKER_BIN || "docker";
  const name = opts.networkName || resolveBuildEgressNetworkName();

  const inspect = await runDockerCli(dockerBin, [
    "network",
    "inspect",
    name,
    "--format",
    "{{json .Internal}}",
  ]);

  if (inspect.code === 0) {
    const raw = inspect.stdout.trim().toLowerCase();
    const internal = raw === "true";
    if (!internal) {
      throw new Error(
        `Docker network "${name}" exists but is not --internal. ` +
          `Remove it (\`docker network rm ${name}\`) so the build supervisor can recreate it for kernel-enforced egress (#170).`
      );
    }
    return { name, created: false, internal: true };
  }

  const create = await runDockerCli(dockerBin, [
    "network",
    "create",
    "--internal",
    "--label",
    "godmode.build.egress=1",
    name,
  ]);
  if (create.code !== 0) {
    throw new Error(
      `Failed to create internal build egress network "${name}": ${create.stderr || create.stdout || `exit ${create.code}`}`
    );
  }
  return { name, created: true, internal: true };
}
