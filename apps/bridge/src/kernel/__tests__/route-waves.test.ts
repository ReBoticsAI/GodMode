import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDir = fileURLToPath(new URL("../../routes/", import.meta.url));
const routeSources = new Map(
  readdirSync(routesDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => [
      name,
      readFileSync(new URL(`../../routes/${name}`, import.meta.url), "utf8"),
    ])
);

function declaredRoutes(
  methodPattern = "get|post|put|patch|delete"
): string[] {
  const routes: string[] = [];
  const expression = new RegExp(
    `router\\.(${methodPattern})\\s*\\(\\s*["']([^"']+)["']`,
    "g"
  );
  for (const [file, source] of routeSources) {
    for (const match of source.matchAll(expression)) {
      routes.push(`${file}:${match[1]}:${match[2]}`);
    }
  }
  return routes.sort();
}

describe("legacy route wave", () => {
  it("exposes only the approved specialized POST transports", () => {
    expect(declaredRoutes("post|put|patch|delete")).toEqual([
      "admin-authority.ts:post:/agent-pause-kills/global",
      "admin-authority.ts:post:/agent-pause-kills/tenant/:tenantId",
      "admin-authority.ts:post:/agent-pause-kills/tenant/:tenantId/agent/:agentId",
      "admin-authority.ts:post:/coding-kills/global",
      "admin-authority.ts:post:/coding-kills/tenant/:tenantId",
      "admin-authority.ts:post:/delete-kills/global",
      "admin-authority.ts:post:/delete-kills/tenant/:tenantId",
      "admin-authority.ts:post:/deploy-kills/global",
      "admin-authority.ts:post:/deploy-kills/tenant/:tenantId",
      "admin-authority.ts:post:/send-kills/global",
      "admin-authority.ts:post:/send-kills/tenant/:tenantId",
      "admin-authority.ts:post:/spend-kills/global",
      "admin-authority.ts:post:/spend-kills/tenant/:tenantId",
      "admin-marketplace.ts:post:/backup",
      "admin-marketplace.ts:post:/sellers/frozen",
      "admin-marketplace.ts:post:/sellers/verified",
      "admin-saas.ts:post:/customers/:userId/access",
      "admin-saas.ts:post:/customers/:userId/complimentary",
      "ai.ts:post:/chat",
      "ai.ts:post:/cursor/refresh",
      "ai.ts:post:/mcp/servers/import",
      "ai.ts:post:/workspace-knowledge/import",
      "ai.ts:put:/mcp/servers",
      "api-core.ts:post:/analytics/timeseries/query",
      "auth.ts:post:/change-password",
      "auth.ts:post:/forgot-password",
      "auth.ts:post:/login",
      "auth.ts:post:/logout",
      "auth.ts:post:/mfa/begin",
      "auth.ts:post:/mfa/confirm",
      "auth.ts:post:/mfa/disable",
      "auth.ts:post:/mfa/verify-login",
      "auth.ts:post:/request-verification",
      "auth.ts:post:/resend-verification",
      "auth.ts:post:/reset-password",
      "auth.ts:post:/signup",
      "auth.ts:post:/tenants",
      "auth.ts:post:/verify-email",
      "coding-workspace.ts:delete:/file",
      "coding-workspace.ts:delete:/terminal/sessions/:sessionId",
      "coding-workspace.ts:post:/file",
      "coding-workspace.ts:post:/mkdir",
      "coding-workspace.ts:post:/rename",
      "coding-workspace.ts:post:/terminal/run",
      "coding-workspace.ts:post:/terminal/sessions",
      "coding-workspace.ts:post:/terminal/sessions/:sessionId/write",
      "coding-workspace.ts:put:/file",
      "dm.ts:post:/conversations/:id/typing",
      "dm.ts:post:/uploads",
      "federation.ts:post:/invites/:token/accept",
      "federation.ts:post:/sc/:verb",
      "github-integration.ts:post:/connect",
      "github-integration.ts:post:/disconnect",
      "marketplace-catalog.ts:post:/community/submission/prepare",
      "marketplace-catalog.ts:post:/community/submission/submit",
      "marketplace-commerce.ts:post:/admin/official-catalog",
      "marketplace-commerce.ts:post:/admin/official-catalog/sync-from-public",
      "marketplace-commerce.ts:post:/checkout",
      "marketplace-commerce.ts:post:/paypal/capture",
      "marketplace.ts:post:/cloud-checkout",
      "marketplace.ts:post:/cloud-checkout/complete",
      "release-submissions.ts:post:/:id/refresh",
      "saas.ts:post:/checkout",
      "saas.ts:post:/portal",
      "support.ts:post:/tickets/:id/to-kanban",
      "user-productivity.ts:patch:/projects/:id",
      "user-productivity.ts:post:/projects",
      "user-productivity.ts:post:/projects/:id/archive",
      "user-productivity.ts:post:/projects/:id/github/link",
      "user-productivity.ts:post:/projects/:id/github/status-map",
      "user-productivity.ts:post:/projects/:id/github/sync",
      "user-productivity.ts:post:/projects/:id/github/unlink",
      "user-productivity.ts:post:/projects/cards/:id/github/comments",
      "user-productivity.ts:put:/projects/:id/columns",
    ]);
  });

  it("keeps representative read routes while removing duplicate mutations", () => {
    const routes = declaredRoutes();
    expect(routes).toEqual(
      expect.arrayContaining([
        "ai.ts:get:/chats",
        "api-core.ts:get:/health",
        "api-core.ts:get:/structure",
        "auth.ts:get:/me",
        "dm.ts:get:/conversations",
        "federation.ts:get:/health",
        "marketplace.ts:get:/listings",
      ])
    );
    for (const removed of [
      "ai.ts:post:/chats",
      "api-core.ts:post:/nodes",
      "auth.ts:patch:/profile",
      "dm.ts:post:/conversations",
      "marketplace.ts:post:/wallet/purchase",
      "user-productivity.ts:post:/projects/cards",
    ]) {
      expect(routes).not.toContain(removed);
    }
  });

  it("delegates anonymous signup provisioning to a kernel action", () => {
    expect(routeSources.get("auth.ts")).not.toMatch(/INSERT INTO users/);
    expect(routeSources.get("auth.ts")).toMatch(
      /executeCollectionAction\(\s*core,\s*"User",\s*"signup"/
    );
  });

  it("delegates streaming chat persistence to kernel CRUD", () => {
    expect(routeSources.get("ai.ts")).not.toMatch(/INSERT INTO ai_messages/);
    expect(routeSources.get("ai.ts")).toMatch(
      /createRecord\(\s*workDb,\s*"ChatMessage"/
    );
  });

  it("delegates DM blob persistence to a kernel action", () => {
    expect(routeSources.get("dm.ts")).not.toMatch(/storeDmBlob\(/);
    expect(routeSources.get("dm.ts")).toMatch(
      /executeCollectionAction\(\s*getHostUsersDb\(\),\s*"DmBlob",\s*"upload"/
    );
  });

  it("delegates federation invite acceptance to a kernel action", () => {
    expect(routeSources.get("federation.ts")).not.toMatch(
      /createShareGrant\(|UPDATE federated_share_invites/
    );
    expect(routeSources.get("federation.ts")).toMatch(
      /executeCollectionAction\(\s*getCloudDb\(\),\s*"FederatedShareInvite",\s*"accept"/
    );
  });
});
