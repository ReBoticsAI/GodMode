/**
 * Layer 3 terminal FS jail via bubblewrap (#112).
 * Hub/client Linux: required. Local Windows: off. No unsandboxed fallback when required.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { config } from "../../config.js";
import {
  JAIL_EGRESS_MOUNT,
  resolveEgressAllowlist,
  wrapAllowlistCommand,
} from "./terminal-egress-proxy.js";

export type CodingTerminalNet = "none" | "shared" | "allowlist";

export function requiresTerminalSandbox(opts?: {
  sandboxMode?: "required" | "off";
  platform?: NodeJS.Platform;
}): boolean {
  const mode = opts?.sandboxMode ?? config.codingTerminalSandbox;
  return mode === "required";
}

export function codingTerminalNetPolicy(opts?: {
  net?: CodingTerminalNet;
}): CodingTerminalNet {
  return opts?.net ?? config.codingTerminalNet;
}

export function codingTerminalEgressHosts(opts?: {
  hosts?: string[];
}): string[] {
  return resolveEgressAllowlist(
    opts?.hosts ?? config.codingTerminalEgressHosts
  );
}

let cachedProbe: { ok: boolean; version?: string; error?: string } | null = null;

/** Probe bubblewrap availability (cached). */
export function probeBubblewrap(opts?: { force?: boolean }): {
  ok: boolean;
  version?: string;
  error?: string;
} {
  if (cachedProbe && !opts?.force) return cachedProbe;
  try {
    const ver = spawnSync("bwrap", ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    if (ver.error || ver.status !== 0) {
      cachedProbe = {
        ok: false,
        error:
          ver.error?.message ??
          (ver.stderr || ver.stdout || "bwrap --version failed").trim(),
      };
      return cachedProbe;
    }
    const smoke = spawnSync(
      "bwrap",
      [
        "--die-with-parent",
        "--unshare-pid",
        "--ro-bind",
        "/usr",
        "/usr",
        "--symlink",
        "usr/bin",
        "/bin",
        "--symlink",
        "usr/lib",
        "/lib",
        "--ro-bind-try",
        "/lib64",
        "/lib64",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
        "--tmpfs",
        "/tmp",
        "--",
        "/usr/bin/true",
      ],
      { encoding: "utf8", timeout: 10_000, windowsHide: true }
    );
    if (smoke.error || smoke.status !== 0) {
      cachedProbe = {
        ok: false,
        version: (ver.stdout || "").trim(),
        error: (
          smoke.error?.message ??
          smoke.stderr ??
          smoke.stdout ??
          "bwrap smoke failed (host may need user namespaces)"
        ).trim(),
      };
      return cachedProbe;
    }
    cachedProbe = { ok: true, version: (ver.stdout || "").trim() };
    return cachedProbe;
  } catch (err) {
    cachedProbe = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    return cachedProbe;
  }
}

/** Reset probe cache (tests). */
export function resetBubblewrapProbeCache(): void {
  cachedProbe = null;
}

function pushRoBindTry(args: string[], hostPath: string): void {
  if (existsSync(hostPath)) {
    args.push("--ro-bind-try", hostPath, hostPath);
  }
}

const ROOT_FS_DIRS = new Set(["/", "/etc", "/usr", "/run", "/var", "/root", "/home"]);

/**
 * Host paths that tenant jails must not see: platform GitHub App PEM, gitconfig
 * credential helpers, and Cloud secret mounts.
 */
export function hostSecretHidePaths(): { dirs: string[]; files: string[] } {
  const dirs = new Set<string>(["/run/godmode-secrets"]);
  const files = new Set<string>(["/etc/gitconfig"]);
  const pem = config.githubApp.privateKeyPath.trim();
  if (pem) {
    files.add(pem);
    const dir = path.dirname(pem);
    if (dir && !ROOT_FS_DIRS.has(dir)) {
      dirs.add(dir);
    }
  }
  return { dirs: [...dirs], files: [...files] };
}

function pushHostSecretHides(
  args: string[],
  extra?: { dirs?: string[]; files?: string[] }
): void {
  const hides = hostSecretHidePaths();
  for (const dir of [...hides.dirs, ...(extra?.dirs ?? [])]) {
    if (!dir.trim()) continue;
    args.push("--tmpfs", dir);
  }
  for (const file of [...hides.files, ...(extra?.files ?? [])]) {
    if (!file.trim()) continue;
    args.push("--ro-bind-try", "/dev/null", file);
  }
}

/**
 * Build bwrap argv (without the leading `bwrap` binary name).
 * Mounts codingRoot at the same host path (rw) so relative tooling stays sane.
 *
 * Network:
 * - none: --unshare-net
 * - shared: host network
 * - allowlist: --unshare-net + UDS CONNECT proxy + in-jail TCP bridge (kernel-enforced)
 */
export function buildBubblewrapArgs(opts: {
  codingRoot: string;
  cwd: string;
  net?: CodingTerminalNet;
  command: string;
  /** Jail-facing proxy URL (http://127.0.0.1:PORT) when net=allowlist. */
  proxyUrl?: string;
  /** Absolute UDS path inside the jail when net=allowlist. */
  jailSocketPath?: string;
  /** Host egress directory bind-mounted at JAIL_EGRESS_MOUNT. */
  hostEgressDir?: string;
  /** Pre-wrapped allowlist command (bridge + user cmd); if omitted, wraps here. */
  wrappedCommand?: string;
  /** Extra host paths to hide (tests / additional host secrets). */
  secretHidePaths?: { dirs?: string[]; files?: string[] };
}): string[] {
  const codingRoot = path.resolve(opts.codingRoot);
  const cwd = path.resolve(opts.cwd);
  const rel = path.relative(codingRoot, cwd);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Terminal cwd escapes coding root");
  }
  const net = codingTerminalNetPolicy({ net: opts.net });
  if (net === "allowlist") {
    const url = String(opts.proxyUrl ?? "").trim();
    const sock = String(opts.jailSocketPath ?? "").trim();
    const egressHost = String(opts.hostEgressDir ?? "").trim();
    if (!url || !sock || !egressHost) {
      throw new Error(
        "CODING_TERMINAL_NET=allowlist requires proxyUrl, jailSocketPath, and hostEgressDir from the Bridge UDS egress proxy"
      );
    }
  }

  const args: string[] = [
    "--die-with-parent",
    "--unshare-pid",
  ];
  // none + allowlist: no IP network in the jail (egress only via UDS → Bridge).
  if (net === "none" || net === "allowlist") {
    args.push("--unshare-net");
  }

  // Prefer /usr + usrmerge symlinks (Debian/Ubuntu in Bridge image).
  pushRoBindTry(args, "/usr");
  if (existsSync("/usr/bin")) {
    args.push("--symlink", "usr/bin", "/bin");
  } else {
    pushRoBindTry(args, "/bin");
  }
  if (existsSync("/usr/lib")) {
    args.push("--symlink", "usr/lib", "/lib");
  } else {
    pushRoBindTry(args, "/lib");
  }
  pushRoBindTry(args, "/lib64");
  pushRoBindTry(args, "/lib32");
  pushRoBindTry(args, "/etc");

  args.push(
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    codingRoot,
    codingRoot
  );

  if (net === "allowlist" && opts.hostEgressDir?.trim()) {
    const hostEgressDir = path.resolve(opts.hostEgressDir.trim());
    args.push("--bind", hostEgressDir, JAIL_EGRESS_MOUNT);
  }

  args.push(
    "--chdir",
    cwd,
    "--clearenv",
    "--setenv",
    "PATH",
    "/usr/local/bin:/usr/bin:/bin",
    "--setenv",
    "HOME",
    codingRoot,
    "--setenv",
    "LANG",
    process.env.LANG || "C.UTF-8",
    "--setenv",
    "TERM",
    process.env.TERM || "xterm-256color"
  );

  let command = opts.command;
  if (net === "allowlist" && opts.proxyUrl && opts.jailSocketPath) {
    const proxyUrl = opts.proxyUrl.trim();
    for (const key of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
      "npm_config_proxy",
      "npm_config_https_proxy",
    ]) {
      args.push("--setenv", key, proxyUrl);
    }
    args.push("--setenv", "NO_PROXY", "");
    args.push("--setenv", "no_proxy", "");
    command =
      opts.wrappedCommand ??
      wrapAllowlistCommand({
        jailSocketPath: opts.jailSocketPath,
        command: opts.command,
      });
  }

  pushHostSecretHides(args, opts.secretHidePaths);

  args.push("--", "/bin/sh", "-c", command);
  return args;
}

/**
 * Interactive shell command inside the jail (#162).
 * Allowlist mode keeps the TCP→UDS bridge alive for the shell lifetime via wrapAllowlistCommand.
 */
export function interactiveShellCommand(opts?: { shell?: string }): string {
  const shell = String(opts?.shell ?? "").trim();
  if (shell === "sh" || shell === "/bin/sh") return "exec /bin/sh -l";
  if (shell === "bash" || shell === "/bin/bash" || !shell) {
    return "exec /bin/bash -l";
  }
  // Reject path escapes: only bare names or absolute /bin|/usr/bin
  if (!/^\/?(bin|usr\/bin)\/[a-z0-9._+-]+$/i.test(shell) && !/^[a-z0-9._+-]+$/i.test(shell)) {
    throw new Error(`Unsupported shell: ${shell}`);
  }
  const abs = shell.startsWith("/") ? shell : `/bin/${shell}`;
  return `exec ${abs} -l`;
}

const DROP_ENV_PREFIXES = [
  "DOCKER_",
  "KUBERNETES_",
  "KUBE_",
  "AWS_SECRET",
  "AWS_ACCESS",
  "CURSOR_API",
  "STRIPE_",
  "RESEND_",
  "OPENAI_API",
  "ANTHROPIC_",
  "GITHUB_APP_",
];

/** Host env for unsandboxed local runs: drop obvious credential/docker vars. */
export function scrubTerminalEnv(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    if (DROP_ENV_PREFIXES.some((p) => key.startsWith(p))) {
      continue;
    }
    if (/SECRET|PASSWORD|TOKEN|PRIVATE_KEY/i.test(key) && key !== "TERM") {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function assertSandboxReadyForTerminal(): void {
  if (!requiresTerminalSandbox()) return;
  if (process.platform === "win32") {
    throw new Error(
      "Terminal sandbox is required on this deployment but Windows cannot run bubblewrap. Use a Linux hub/client image."
    );
  }
  const probe = probeBubblewrap();
  if (!probe.ok) {
    throw new Error(
      `Terminal sandbox required but bubblewrap is unavailable: ${probe.error ?? "unknown"}. Install bubblewrap and ensure user namespaces work inside the container.`
    );
  }
  if (codingTerminalNetPolicy() === "allowlist") {
    const hosts = codingTerminalEgressHosts();
    if (hosts.length === 0) {
      throw new Error(
        "CODING_TERMINAL_NET=allowlist requires a non-empty CODING_TERMINAL_EGRESS_HOSTS allowlist"
      );
    }
  }
}
