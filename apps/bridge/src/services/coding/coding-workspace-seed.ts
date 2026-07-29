/**
 * Idempotent starter file for empty tenant coding roots (hub + SaaS).
 * Keeps Files UI from opening on a blank workspace for new tenants.
 */
import fs from "node:fs";
import path from "node:path";

export const CODING_STARTER_FILENAME = "hello.md";

export const CODING_STARTER_MARKDOWN = [
  "# Welcome to your coding workspace",
  "",
  "This folder is the sandboxed coding root for your GodMode tenant.",
  "",
  "Agents, the Files browser, and Terminal all share this directory. Create and edit files here; they stay isolated to this workspace.",
  "",
  "Try opening this file, making a small edit, or creating a new file from the Files toolbar.",
  "",
].join("\n");

/**
 * If `dir` exists, is empty, and has no starter file, write `hello.md`.
 * Never overwrites an existing file. Safe to call on every ensure/list.
 *
 * @returns true when the starter file was created
 */
export function seedCodingWorkspaceStarter(dir: string): boolean {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return false;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    return false;
  }
  if (!stat.isDirectory()) return false;

  const helloPath = path.join(root, CODING_STARTER_FILENAME);
  if (fs.existsSync(helloPath)) return false;

  let entries: string[];
  try {
    entries = fs.readdirSync(root).filter((n) => n !== "." && n !== "..");
  } catch {
    return false;
  }
  if (entries.length > 0) return false;

  try {
    fs.writeFileSync(helloPath, CODING_STARTER_MARKDOWN, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "EEXIST") return false;
    throw err;
  }
  return true;
}
