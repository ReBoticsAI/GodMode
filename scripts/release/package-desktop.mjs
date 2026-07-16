import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { hostPlatformLabel, stageRuntime } from "./stage-runtime.mjs";

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
const stage = path.join(desktopRoot, ".stage-runtime");

await stageRuntime({
  platform,
  version,
  commit,
  stageDir: stage,
  includeServices: false,
  root,
});

await rm(runtimeDest, { recursive: true, force: true });
await mkdir(runtimeDest, { recursive: true });
await cp(stage, runtimeDest, { recursive: true });
await rm(stage, { recursive: true, force: true });

await rm(updateDest, { recursive: true, force: true });
await mkdir(updateDest, { recursive: true });
for (const name of ["supervisor.mjs", "desktop-update.mjs", "bare-metal-update.mjs"]) {
  await cp(path.join(root, "scripts", "update", name), path.join(updateDest, name));
}

const electronVersion = version.replace(/^v/, "");
const builderArgs = [
  "run",
  "dist",
  "-w",
  "@godmode/desktop",
  "--",
  `-c.extraMetadata.version=${electronVersion}`,
  "--publish",
  "never",
];
if (process.platform === "win32") {
  builderArgs.push("--win", "--x64");
} else if (process.platform === "darwin") {
  builderArgs.push("--mac", process.arch === "arm64" ? "--arm64" : "--x64");
} else {
  builderArgs.push("--linux", "--x64");
}

const result = spawnSync("npm", builderArgs, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    // electron-builder reads package version for artifact names
  },
  shell: process.platform === "win32",
});
if (result.status !== 0) {
  throw new Error(`electron-builder failed with status ${result.status}`);
}

// Pin product version into package.json temporarily is messy; rename outputs.
const desktopOut = path.join(root, "release-out", "desktop");
const publishDir = path.resolve(outputDirectory);
await mkdir(publishDir, { recursive: true });

const files = await readdir(desktopOut).catch(() => []);
for (const name of files) {
  const lower = name.toLowerCase();
  if (
    !lower.endsWith(".exe") &&
    !lower.endsWith(".dmg") &&
    !lower.endsWith(".appimage") &&
    !lower.endsWith(".deb") &&
    !lower.endsWith(".zip")
  ) {
    continue;
  }
  const source = path.join(desktopOut, name);
  // Prefer canonical GodMode-* names already set in electron-builder artifactName.
  // Rewrite version segment if electron-builder used package.json 0.1.0.
  const renamed = name.includes(electronVersion)
    ? name
    : name.replace(/0\.1\.0/g, electronVersion).replace(/\$\{version\}/g, electronVersion);
  const destination = path.join(publishDir, renamed.startsWith("GodMode") ? renamed : `GodMode-${renamed}`);
  await cp(source, destination);
  console.log(destination);
}
