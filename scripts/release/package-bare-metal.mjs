import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  bareMetalArchiveName,
  bareMetalStageDirName,
} from "./artifact-names.mjs";
import { stageRuntime } from "./stage-runtime.mjs";

const [platform, outputDirectory = "release-out"] = process.argv.slice(2);
const version = process.env.RELEASE_VERSION;
const commit = process.env.RELEASE_COMMIT;
if (!["linux-x64", "windows-x64"].includes(platform) || !version || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
  throw new Error(
    "Usage: RELEASE_VERSION=vX.Y.Z RELEASE_COMMIT=<40-char-sha> node package-bare-metal.mjs <linux-x64|windows-x64> [output-dir]"
  );
}

const root = process.cwd();
const bundleName = bareMetalStageDirName(platform, version);
const stage = path.resolve(outputDirectory, bundleName);
await stageRuntime({
  platform,
  version,
  commit,
  stageDir: stage,
  includeServices: true,
  root,
});

await mkdir(path.resolve(outputDirectory), { recursive: true });
const archive = path.resolve(outputDirectory, bareMetalArchiveName(platform, version));
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
