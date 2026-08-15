/**
 * Layer 3 terminal sandbox (#112): bwrap argv + cross-tenant FS jail.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildBubblewrapArgs,
  interactiveShellCommand,
  probeBubblewrap,
  resetBubblewrapProbeCache,
  scrubTerminalEnv,
} from "../coding/terminal-sandbox.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
  resetBubblewrapProbeCache();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

describe("buildBubblewrapArgs", () => {
  it("binds coding root rw, chdirs under it, and unshares net by default", () => {
    const root = tempDir("gm-bwrap-root-");
    mkdirSync(join(root, "src"), { recursive: true });
    const args = buildBubblewrapArgs({
      codingRoot: root,
      cwd: join(root, "src"),
      command: "echo ok",
      net: "none",
    });
    expect(args).toContain("--die-with-parent");
    expect(args).toContain("--unshare-pid");
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--bind");
    const bindIdx = args.indexOf("--bind");
    expect(args[bindIdx + 1]).toBe(root);
    expect(args[bindIdx + 2]).toBe(root);
    const chdirIdx = args.indexOf("--chdir");
    expect(args[chdirIdx + 1]).toBe(join(root, "src"));
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", "echo ok"]);
  });

  it("hides host GitHub App secret mounts from the jail", () => {
    const root = tempDir("gm-bwrap-hide-");
    const args = buildBubblewrapArgs({
      codingRoot: root,
      cwd: root,
      command: "true",
      net: "none",
    });
    expect(args).toContain("/run/godmode-secrets");
    const secretDirIdx = args.indexOf("/run/godmode-secrets");
    expect(args[secretDirIdx - 1]).toBe("--tmpfs");
    expect(args).toContain("/etc/gitconfig");
    const hideFileIdx = args.indexOf("/etc/gitconfig");
    expect(args[hideFileIdx - 2]).toBe("--ro-bind-try");
    expect(args[hideFileIdx - 1]).toBe("/dev/null");
  });

  it("omits --unshare-net when net=shared", () => {
    const root = tempDir("gm-bwrap-net-");
    const args = buildBubblewrapArgs({
      codingRoot: root,
      cwd: root,
      command: "true",
      net: "shared",
    });
    expect(args).not.toContain("--unshare-net");
  });

  it("allowlist uses --unshare-net, binds host egress, and forces jail proxy env", () => {
    const root = tempDir("gm-bwrap-allow-");
    const egress = tempDir("gm-bwrap-egress-");
    const args = buildBubblewrapArgs({
      codingRoot: root,
      cwd: root,
      command: "true",
      net: "allowlist",
      proxyUrl: "http://127.0.0.1:18080",
      jailSocketPath: "/run/godmode-egress/proxy.sock",
      hostEgressDir: egress,
      wrappedCommand: "echo wrapped",
    });
    expect(args).toContain("--unshare-net");
    const httpsIdx = args.indexOf("HTTPS_PROXY");
    expect(httpsIdx).toBeGreaterThan(0);
    expect(args[httpsIdx + 1]).toBe("http://127.0.0.1:18080");
    expect(args).toContain("npm_config_https_proxy");
    expect(args).toContain("/run/godmode-egress");
    const egressBind = args.indexOf(resolve(egress));
    expect(egressBind).toBeGreaterThan(0);
    expect(args[egressBind + 1]).toBe("/run/godmode-egress");
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", "echo wrapped"]);
  });

  it("allowlist without proxyUrl/jailSocketPath/hostEgressDir fails closed", () => {
    const root = tempDir("gm-bwrap-allow-miss-");
    expect(() =>
      buildBubblewrapArgs({
        codingRoot: root,
        cwd: root,
        command: "true",
        net: "allowlist",
      })
    ).toThrow(/proxyUrl, jailSocketPath, and hostEgressDir/i);
  });

  it("rejects cwd outside coding root", () => {
    const root = tempDir("gm-bwrap-esc-");
    const other = tempDir("gm-bwrap-other-");
    expect(() =>
      buildBubblewrapArgs({
        codingRoot: root,
        cwd: other,
        command: "true",
      })
    ).toThrow(/escapes/i);
  });
});

describe("interactiveShellCommand", () => {
  it("defaults to bash login shell", () => {
    expect(interactiveShellCommand()).toBe("exec /bin/bash -l");
    expect(interactiveShellCommand({ shell: "sh" })).toBe("exec /bin/sh -l");
  });

  it("rejects unsafe shell strings", () => {
    expect(() => interactiveShellCommand({ shell: "../../bin/evil" })).toThrow(
      /Unsupported shell/
    );
  });
});

describe("scrubTerminalEnv", () => {
  it("drops docker and secret-like keys", () => {
    const scrubbed = scrubTerminalEnv({
      PATH: "/usr/bin",
      DOCKER_HOST: "unix:///var/run/docker.sock",
      AWS_SECRET_ACCESS_KEY: "x",
      MY_PASSWORD: "y",
      TERM: "xterm",
    });
    expect(scrubbed.PATH).toBe("/usr/bin");
    expect(scrubbed.TERM).toBe("xterm");
    expect(scrubbed.DOCKER_HOST).toBeUndefined();
    expect(scrubbed.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(scrubbed.MY_PASSWORD).toBeUndefined();
  });

  it("drops host GitHub App env so tenant shells cannot mint platform JWTs", () => {
    const scrubbed = scrubTerminalEnv({
      PATH: "/usr/bin",
      GITHUB_APP_ID: "123456",
      GITHUB_APP_CLIENT_ID: "Iv1.abc",
      GITHUB_APP_PRIVATE_KEY_PATH: "/run/godmode-secrets/github-app.pem",
      HOME: "/home/godmode",
    });
    expect(scrubbed.PATH).toBe("/usr/bin");
    expect(scrubbed.HOME).toBe("/home/godmode");
    expect(scrubbed.GITHUB_APP_ID).toBeUndefined();
    expect(scrubbed.GITHUB_APP_CLIENT_ID).toBeUndefined();
    expect(scrubbed.GITHUB_APP_PRIVATE_KEY_PATH).toBeUndefined();
  });
});

describe("bubblewrap FS jail", () => {
  it("blocks absolute reads outside the coding root when bwrap works", () => {
    if (process.platform === "win32") {
      return;
    }
    resetBubblewrapProbeCache();
    const probe = probeBubblewrap({ force: true });
    if (!probe.ok) {
      // Local Windows-dev / hosts without userns: unit tests above still run.
      console.warn(`skip FS jail integration: ${probe.error}`);
      return;
    }

    const workspaces = tempDir("gm-bwrap-ws-");
    const tenantA = join(workspaces, "tenant-a");
    const tenantB = join(workspaces, "tenant-b");
    mkdirSync(tenantA, { recursive: true });
    mkdirSync(tenantB, { recursive: true });
    const secretPath = join(tenantB, "secret.txt");
    writeFileSync(secretPath, "tenant-b-secret\n", "utf8");
    writeFileSync(join(tenantA, "ok.txt"), "a\n", "utf8");

    const readOwn = spawnSync(
      "bwrap",
      buildBubblewrapArgs({
        codingRoot: tenantA,
        cwd: tenantA,
        command: "cat ok.txt",
        net: "none",
      }),
      { encoding: "utf8", timeout: 15_000 }
    );
    expect(readOwn.status).toBe(0);
    expect(readOwn.stdout).toContain("a");

    const leak = spawnSync(
      "bwrap",
      buildBubblewrapArgs({
        codingRoot: tenantA,
        cwd: tenantA,
        command: `cat ${secretPath.replace(/'/g, "'\\''")}`,
        net: "none",
      }),
      { encoding: "utf8", timeout: 15_000 }
    );
    expect(leak.status).not.toBe(0);
    expect(leak.stdout + leak.stderr).not.toMatch(/tenant-b-secret/);
  });
});
