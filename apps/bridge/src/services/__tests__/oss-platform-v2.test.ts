/**
 * OSS platform v2 smoke tests (support routing, plugin scaffold).
 * Run: npx tsx apps/bridge/src/services/__tests__/oss-platform-v2.test.ts
 */
import assert from "node:assert/strict";
import { buildGithubIssueUrl, GITHUB_ISSUES_NEW_URL } from "../support-service.js";
import { prepareMarketplaceSubmission } from "../plugin-scaffold.js";

const url = buildGithubIssueUrl("Bug", "Steps to reproduce");
assert.ok(url.startsWith(GITHUB_ISSUES_NEW_URL));
assert.ok(url.includes("title=Bug"));
assert.ok(url.includes("body=Steps"));

const manifest = prepareMarketplaceSubmission({
  id: "my-pack",
  title: "My Pack",
  description: "Test",
  pluginRepo: "https://github.com/example/plugin",
});
assert.equal(manifest.id, "my-pack");
assert.equal(manifest.installType, "plugin");
assert.ok(String(manifest.contributingUrl).includes("GodMode-Marketplace"));

console.log("oss-platform-v2.test.ts: ok");
