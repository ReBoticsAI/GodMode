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
      "admin-saas.ts:post:/customers/:userId/access",
      "ai.ts:post:/chat",
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
      "auth.ts:post:/reset-password",
      "auth.ts:post:/signup",
      "auth.ts:post:/verify-email",
      "dm.ts:post:/conversations/:id/typing",
      "dm.ts:post:/uploads",
      "federation.ts:post:/invites/:token/accept",
      "federation.ts:post:/sc/:verb",
      "marketplace-commerce.ts:post:/admin/official-catalog",
      "marketplace-commerce.ts:post:/paypal/capture",
      "saas.ts:post:/checkout",
      "saas.ts:post:/portal",
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
      /executeCollectionAction\(\s*getCoreDb\(\),\s*"DmBlob",\s*"upload"/
    );
  });

  it("delegates federation invite acceptance to a kernel action", () => {
    expect(routeSources.get("federation.ts")).not.toMatch(
      /createShareGrant\(|UPDATE federated_share_invites/
    );
    expect(routeSources.get("federation.ts")).toMatch(
      /executeCollectionAction\(\s*getCoreDb\(\),\s*"FederatedShareInvite",\s*"accept"/
    );
  });
});
