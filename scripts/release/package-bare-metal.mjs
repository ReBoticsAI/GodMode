import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const [platform, outputDirectory = "release-out"] = process.argv.slice(2);
const version = process.env.RELEASE_VERSION;
const commit = process.env.RELEASE_COMMIT;
if (!["linux-x64", "windows-x64"].includes(platform) || !version || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
  throw new Error("Usage: RELEASE_VERSION=vX.Y.Z RELEASE_COMMIT=<40-char-sha> node package-bare-metal.mjs <linux-x64|windows-x64> [output-dir]");
}

const root = process.cwd();
const bundleName = `godmode-${version}-${platform}`;
const stage = path.resolve(outputDirectory, bundleName);
await rm(stage, { recursive: true, force: true });
await mkdir(path.join(stage, "bin"), { recursive: true });

const copy = (source, destination) => cp(path.join(root, source), path.join(stage, destination), {
  recursive: true,
  verbatimSymlinks: true,
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
await cp(process.execPath, path.join(stage, "bin", platform === "windows-x64" ? "node.exe" : "node"));
for (const name of ["flow-core", "kernel", "plugin-api", "plugin-host"]) {
  const installed = path.join(stage, "node_modules", "@godmode", name);
  await rm(installed, { recursive: true, force: true });
  await cp(path.join(stage, "packages", name), installed, { recursive: true });
}

await writeFile(path.join(stage, "release.json"), `${JSON.stringify({ version, commit, platform }, null, 2)}\n`);
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
  await chmod(path.join(stage, "bin", "node"), 0o755);
  await chmod(path.join(stage, "bin", "godmode"), 0o755);
  await chmod(path.join(stage, "install-linux.sh"), 0o755);
  await chmod(path.join(stage, "update", "godmode-update.sh"), 0o755);
} else {
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
      `Add-Type -Path '${path.resolve("deploy/bare-metal/GodModeService.cs").replaceAll("'", "''")}' -OutputAssembly '${path.join(stage, "bin", "GodModeService.exe").replaceAll("'", "''")}' -OutputType WindowsApplication -ReferencedAssemblies System.ServiceProcess`,
    ],
    { stdio: "inherit" }
  );
}

await mkdir(path.resolve(outputDirectory), { recursive: true });
const archive = path.resolve(outputDirectory, `${bundleName}.${platform === "windows-x64" ? "zip" : "tar.gz"}`);
// Always archive the versioned root directory so extractors see one runtime folder.
const command =
  platform === "windows-x64" && process.platform === "win32"
    ? [
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Compress-Archive -Path '${stage.replaceAll("'", "''")}' -DestinationPath '${archive.replaceAll("'", "''")}' -Force`,
        ],
      ]
    : ["tar", ["-czf", archive, "-C", path.resolve(outputDirectory), bundleName]];
const result = spawnSync(command[0], command[1], { stdio: "inherit" });
if (result.status !== 0) throw new Error(`Archive command failed with status ${result.status}`);
await rm(stage, { recursive: true, force: true });
console.log(archive);
