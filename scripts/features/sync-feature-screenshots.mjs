#!/usr/bin/env node
/**
 * Sync docs/assets/features/*.png → apps/web/public/features/
 * and inject/update screenshot images in docs/features/*.md bodies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.join(root, "docs/assets/features");
const publicDir = path.join(root, "apps/web/public/features");
const mdDir = path.join(root, "docs/features");

const SKIP = /^(page-|sierra-|z440-)/;

fs.mkdirSync(publicDir, { recursive: true });
const pngs = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith(".png") && !SKIP.test(f));

for (const name of pngs) {
  fs.copyFileSync(path.join(srcDir, name), path.join(publicDir, name));
}

const IMAGE_BLOCK =
  /(^|\r?\n)!\[[^\]]*]\(\/features\/[a-z0-9_-]+\.png\)\r?\n*/gi;

for (const file of fs.readdirSync(mdDir).filter((f) => f.endsWith(".md"))) {
  const slug = path.basename(file, ".md");
  if (slug === "_index") continue;
  const pngName = `${slug}.png`;
  if (!pngs.includes(pngName)) continue;

  const full = path.join(mdDir, file);
  let raw = fs.readFileSync(full, "utf8");
  const end = raw.indexOf("\n---", 3);
  if (end < 0) continue;
  let bodyStart = end + 4;
  while (raw[bodyStart] === "\r" || raw[bodyStart] === "\n") bodyStart += 1;
  const fm = raw.slice(0, bodyStart);
  let body = raw
    .slice(bodyStart)
    .replace(IMAGE_BLOCK, "\n")
    .replace(/^[\r\n]+/, "");
  const imageLine = `![${slug} in GodMode](/features/${pngName})\n\n`;
  if (/^#\s+/.test(body)) {
    body = body.replace(/^(#\s+[^\r\n]+\r?\n+)/, `$1\n${imageLine}`);
  } else {
    body = imageLine + body;
  }
  const out = (fm.replace(/[\r\n]+$/, "\n") + body).replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(full, out.endsWith("\n") ? out : out + "\n");
}

console.log(`Synced ${pngs.length} feature screenshots to public/ and markdown.`);
