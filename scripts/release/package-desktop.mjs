import { cp, mkdir, readdir, rename, rm, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  desktopInstallerName,
  installerExtensionFromFilename,
} from "./artifact-names.mjs";
import { hostPlatformLabel, stageRuntime } from "./stage-runtime.mjs";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

const outputDirectory = process.argv[2] ?? "release-out";
const version = process.env.RELEASE_VERSION;
const commit = process.env.RELEASE_COMMIT;
const platform = process.env.DESKTOP_PLATFORM || hostPlatformLabel();

if (!version || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
  throw new Error(
    "Usage: RELEASE_VERSION=vX.Y.Z RELEASE_COMMIT=<40-char-sha> node package-desktop.mjs [output-dir]"
  );
}

const root = process.cwd();
const desktopRoot = path.join(root, "apps", "desktop");
const runtimeDest = path.join(desktopRoot, "resources", "runtime");
const updateDest = path.join(desktopRoot, "resources", "update");
// Prefer a fresh temp stage so leftover locked files under apps/desktop/.stage-runtime
// (Windows AV / prior electron copies) cannot block packaging.
const stage = path.join(
  root,
  "release-out",
  `.desktop-stage-${process.pid}-${Date.now()}`
);

await stageRuntime({
  platform,
  version,
  commit,
  stageDir: stage,
  includeServices: false,
  root,
});

await rm(runtimeDest, { recursive: true, force: true });
await mkdir(path.dirname(runtimeDest), { recursive: true });
// Copy stage directory onto runtimeDest path (replace), not into an existing folder.
await cp(stage, runtimeDest, { recursive: true });
await rm(stage, { recursive: true, force: true });

// electron-builder honors .gitignore and would omit node_modules from extraResources.
// Stage deps under _node_modules; after-pack.cjs renames them back inside the app.
const runtimeNodeModules = path.join(runtimeDest, "node_modules");
const runtimeBundledModules = path.join(runtimeDest, "_node_modules");
if (await exists(runtimeNodeModules)) {
  await rm(runtimeBundledModules, { recursive: true, force: true });
  await rename(runtimeNodeModules, runtimeBundledModules);
}

await rm(updateDest, { recursive: true, force: true });
await mkdir(updateDest, { recursive: true });
for (const name of ["supervisor.mjs", "desktop-update.mjs", "bare-metal-update.mjs"]) {
  await cp(path.join(root, "scripts", "update", name), path.join(updateDest, name));
}

const electronVersion = version.replace(/^v/, "");
const packDirOnly = process.env.DESKTOP_PACK_DIR === "1";
const builderArgs = [
  "run",
  packDirOnly ? "pack" : "dist",
  "-w",
  "@godmode/desktop",
  "--",
  `-c.extraMetadata.version=${electronVersion}`,
  // Avoid NSIS install dir "@godmodedesktop" from the scoped package name.
  "-c.extraMetadata.name=GodMode",
  "--publish",
  "never",
];
if (process.platform === "win32") {
  builderArgs.push("--win", "--x64");
} else if (process.platform === "darwin") {
  builderArgs.push("--mac", process.arch === "arm64" ? "--arm64" : "--x64");
  // Force unsigned nightlies even if a blank CSC_LINK leaks into the env.
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false") {
    builderArgs.push("-c.mac.identity=null");
  }
} else {
  builderArgs.push("--linux", "--x64");
}

const result = spawnSync("npm", builderArgs, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
  },
  shell: process.platform === "win32",
});
if (result.status !== 0) {
  throw new Error(`electron-builder failed with status ${result.status}`);
}

const desktopOut = path.join(root, "release-out", "desktop");
const publishDir = path.resolve(outputDirectory);
await mkdir(publishDir, { recursive: true });

const files = await readdir(desktopOut).catch(() => []);
for (const name of files) {
  const ext = installerExtensionFromFilename(name);
  if (!ext || ext === "zip" || ext === "tar.gz") continue;
  const source = path.join(desktopOut, name);
  const destination = path.join(
    publishDir,
    desktopInstallerName(platform, version, ext)
  );
  await cp(source, destination);
  console.log(destination);
}
