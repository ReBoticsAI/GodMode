import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const fetchCommunityCatalog = vi.fn(async () => ({
  url: "https://example.com/catalog.json",
  entries: [
    {
      id: "community-ping",
      title: "Community Ping",
      author: "Dane Schell",
      pluginRepo: "https://github.com/ReBoticsAI/gm-442-smoke-test",
      installType: "plugin",
    },
  ],
}));

const getSellerEntitlementPayload = vi.fn(() => ({
  sellerActive: true,
  planId: "seller",
  source: "seller",
  githubConnected: true,
  githubLogin: "DaneSchell",
  tosAccepted: true,
  stripePayoutReady: true,
}));

const ensureSellerListingTenant = vi.fn(() => "tenant-seller-1");

const publishMarketplaceListing = vi.fn(() => ({
  id: "cloud-listing-1",
  catalog_entry_id: "community-ping",
  status: "active",
}));

vi.mock("../marketplace-catalog.js", () => ({
  fetchCommunityCatalog,
}));

vi.mock("../saas-subscriptions.js", () => ({
  getSellerEntitlementPayload,
}));

vi.mock("../seller-listing-tenant.js", () => ({
  ensureSellerListingTenant,
}));

vi.mock("../marketplace-listings.js", () => ({
  publishMarketplaceListing,
}));

vi.mock("../../tenant-registry.js", () => ({
  getTenantDb: vi.fn(() => ({})),
}));

const { publishListingForSellerLinkUser } = await import("../seller-link-cloud-publish.js");
const { MarketplaceCommerceError } = await import("../marketplace-commerce.js");

describe("publishListingForSellerLinkUser (#709)", () => {
  beforeEach(() => {
    fetchCommunityCatalog.mockClear();
    getSellerEntitlementPayload.mockClear();
    ensureSellerListingTenant.mockClear();
    publishMarketplaceListing.mockClear();
    getSellerEntitlementPayload.mockReturnValue({
      sellerActive: true,
      planId: "seller",
      source: "seller",
      githubConnected: true,
      githubLogin: "DaneSchell",
      tosAccepted: true,
      stripePayoutReady: true,
    });
  });

  it("publishes plugin listing for seller-link Cloud user", async () => {
    const core = {} as never;
    const userId = randomUUID();
    const row = await publishListingForSellerLinkUser(core, userId, {
      catalogEntryId: "community-ping",
      kind: "plugin",
      priceCents: 100,
      stripeConnectAttestation: true,
    });
    expect(row.id).toBe("cloud-listing-1");
    expect(ensureSellerListingTenant).toHaveBeenCalledWith(core, userId);
    expect(publishMarketplaceListing).toHaveBeenCalledWith(
      core,
      {},
      expect.objectContaining({
        sellerUserId: userId,
        sellerTenantId: "tenant-seller-1",
        catalogEntryId: "community-ping",
        githubLogin: "DaneSchell",
        priceCents: 100,
      })
    );
  });

  it("rejects when GitHub is not connected on Cloud", async () => {
    getSellerEntitlementPayload.mockReturnValueOnce({
      sellerActive: true,
      planId: "seller",
      source: "seller",
      githubConnected: false,
      githubLogin: null,
      tosAccepted: true,
      stripePayoutReady: true,
    });
    await expect(
      publishListingForSellerLinkUser({} as never, randomUUID(), {
        catalogEntryId: "community-ping",
        priceCents: 100,
        stripeConnectAttestation: true,
      })
    ).rejects.toBeInstanceOf(MarketplaceCommerceError);
  });
});
