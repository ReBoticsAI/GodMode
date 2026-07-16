import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const RUNTIME_PLATFORMS = [
  "linux-x64",
  "windows-x64",
  "darwin-x64",
  "darwin-arm64",
];

/**
 * Stage a Bridge + web + Node runtime directory for bare-metal or Electron packaging.
 * @param {{
 *   platform: string,
 *   version: string,
 *   commit: string,
 *   stageDir: string,
 *   includeServices?: boolean,
 *   root?: string,
 * }} options
 */
export async function stageRuntime({
  platform,
  version,
  commit,
  stageDir,
  includeServices = true,
  root = process.cwd(),
}) {
  if (!RUNTIME_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported runtime platform: ${platform}`);
  }
  if (!version || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
    throw new Error("version and a 40-char commit SHA are required");
  }

  await rm(stageDir, { recursive: true, force: true });
  await mkdir(path.join(stageDir, "bin"), { recursive: true });

  const copy = (source, destination, options = {}) =>
    cp(path.join(root, source), path.join(stageDir, destination), {
      recursive: true,
      // Flatten npm workspace / nested symlinks so packaged runtimes are portable.
      dereference: true,
      ...options,
    });

  await Promise.all([
    copy("package.json", "package.json"),
    copy("package-lock.json", "package-lock.json"),
    copy("node_modules", "node_modules"),
    copy("apps/bridge/package.json", "apps/bridge/package.json"),
    copy("apps/bridge/dist", "apps/bridge/dist"),
    copy("apps/web/dist", "apps/web/dist"),
    copy("deploy/bare-metal/host.mjs", "bin/host.mjs"),
    ...["flow-core", "kernel", "plugin-api", "plugin-host"].flatMap((name) => [
      copy(`packages/${name}/package.json`, `packages/${name}/package.json`),
      copy(`packages/${name}/dist`, `packages/${name}/dist`),
    ]),
  ]);

  const nodeName = platform.startsWith("windows") ? "node.exe" : "node";
  await cp(process.execPath, path.join(stageDir, "bin", nodeName));

  for (const name of ["flow-core", "kernel", "plugin-api", "plugin-host"]) {
    const installed = path.join(stageDir, "node_modules", "@godmode", name);
    await rm(installed, { recursive: true, force: true });
    await cp(path.join(stageDir, "packages", name), installed, { recursive: true });
  }

  if (!includeServices) {
    // Drop Electron packaging tooling if present; desktop runtime is Bridge+web only.
    const nm = path.join(stageDir, "node_modules");
    const entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(nm).catch(() => [])
    );
    for (const entry of entries) {
      if (
        /^electron/i.test(entry) ||
        entry === "app-builder-bin" ||
        entry === "app-builder-lib" ||
        entry === "electron-winstaller" ||
        entry === "electron-publish"
      ) {
        await rm(path.join(nm, entry), { recursive: true, force: true });
      }
    }
  }

  await writeFile(
    path.join(stageDir, "release.json"),
    `${JSON.stringify({ version, commit, platform }, null, 2)}\n`
  );

  if (!includeServices) {
    if (!platform.startsWith("windows")) {
      await chmod(path.join(stageDir, "bin", "node"), 0o755);
    }
    return stageDir;
  }

  if (platform === "linux-x64") {
    await Promise.all([
      copy("deploy/bare-metal/godmode", "bin/godmode"),
      copy("deploy/bare-metal/godmode.service", "godmode.service"),
      copy(
        "deploy/bare-metal/godmode-update-supervisor.service",
        "godmode-update-supervisor.service"
      ),
      copy("deploy/bare-metal/install-linux.sh", "install-linux.sh"),
      copy("scripts/update/godmode-update.sh", "update/godmode-update.sh"),
      copy("scripts/update/supervisor.mjs", "update/supervisor.mjs"),
      copy("scripts/update/bare-metal-update.mjs", "update/bare-metal-update.mjs"),
    ]);
    await chmod(path.join(stageDir, "bin", "node"), 0o755);
    await chmod(path.join(stageDir, "bin", "godmode"), 0o755);
    await chmod(path.join(stageDir, "install-linux.sh"), 0o755);
    await chmod(path.join(stageDir, "update", "godmode-update.sh"), 0o755);
  } else if (platform === "windows-x64") {
    await Promise.all([
      copy("deploy/bare-metal/godmode.cmd", "bin/godmode.cmd"),
      copy("deploy/bare-metal/godmode-service.xml", "godmode-service.xml"),
      copy("deploy/bare-metal/install-windows.ps1", "install-windows.ps1"),
      copy("scripts/update/godmode-update.ps1", "update/godmode-update.ps1"),
      copy("scripts/update/supervisor.mjs", "update/supervisor.mjs"),
      copy("scripts/update/bare-metal-update.mjs", "update/bare-metal-update.mjs"),
    ]);
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Add-Type -Path '${path.resolve(root, "deploy/bare-metal/GodModeService.cs").replaceAll("'", "''")}' -OutputAssembly '${path.join(stageDir, "bin", "GodModeService.exe").replaceAll("'", "''")}' -OutputType WindowsApplication -ReferencedAssemblies System.ServiceProcess`,
      ],
      { stdio: "inherit" }
    );
  } else {
    // Darwin runtimes are desktop-only; bare-metal services are not packaged.
    await chmod(path.join(stageDir, "bin", "node"), 0o755);
  }

  return stageDir;
}

export function hostPlatformLabel() {
  if (process.platform === "win32") return "windows-x64";
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  // Desktop Linux installers are x64-only in this milestone.
  return "linux-x64";
}
