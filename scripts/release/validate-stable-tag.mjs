import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  throw new Error("Usage: validate-stable-tag.mjs vX.Y.Z");
}
const version = tag.slice(1);
const root = JSON.parse(await readFile("package.json", "utf8"));
if (root.version !== version) {
  throw new Error(`Root package version ${root.version} does not match ${tag}`);
}

const packageFiles = [];
for (const workspacePattern of root.workspaces ?? []) {
  if (!workspacePattern.endsWith("/*")) {
    packageFiles.push(path.join(workspacePattern, "package.json"));
    continue;
  }
  const parent = workspacePattern.slice(0, -2);
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isDirectory()) packageFiles.push(path.join(parent, entry.name, "package.json"));
  }
}
for (const file of packageFiles.sort()) {
  let workspace;
  try {
    workspace = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  if (workspace.version !== version) {
    throw new Error(`${file} version ${workspace.version ?? "<missing>"} does not match ${tag}`);
  }
}

const changelog = await readFile("CHANGELOG.md", "utf8");
if (!new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\](?:\\s|$)`, "m").test(changelog)) {
  throw new Error(`CHANGELOG.md is missing a ## [${version}] release entry`);
}
console.log(`Validated ${tag} across root, workspaces, and CHANGELOG.md`);
