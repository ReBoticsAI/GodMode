import { describe, expect, it } from "vitest";
import {
  marketplaceCloudCommunityUrl,
  marketplaceCloudSellUrl,
  marketplaceCloudVaultMarketplaceUrl,
  marketplaceSellerStorefrontUrl,
  communityCheckoutBody,
  formatMarketplaceCents,
  installedEmptyHint,
  listingStatusLabel,
  localSellChecklistComplete,
  localSellSeatReady,
  mergeLocalSellChecklistSignals,
  sellerLinkExchangeFromSearch,
  marketplaceShowsLocalTab,
  normalizeMarketplaceTab,
  officialCatalogEmptyMessage,
  sellerPayoutStatusFromAccount,
  userFacingErrorMessage,
} from "@/lib/marketplace-format";

describe("marketplaceCloudCommunityUrl", () => {
  it("points at the Cloud Community tab", () => {
    expect(marketplaceCloudCommunityUrl("https://app.godmode.software")).toBe(
      "https://app.godmode.software/marketplace?tab=community"
    );
  });
});

describe("marketplaceCloudSellUrl", () => {
  it("points at the Cloud Sell tab", () => {
    expect(marketplaceCloudSellUrl("https://app.godmode.software")).toBe(
      "https://app.godmode.software/marketplace?tab=seller"
    );
  });
});

describe("localSellChecklistComplete (#681)", () => {
  const base = {
    linked: true,
    sellerActive: true,
    githubConnected: true,
    tosAccepted: true,
    stripePayoutReady: true,
  };

  it("requires all four readiness signals plus active seat", () => {
    expect(localSellChecklistComplete(base)).toBe(true);
    expect(localSellSeatReady(base)).toBe(true);
    expect(localSellChecklistComplete({ ...base, linked: false })).toBe(false);
    expect(localSellChecklistComplete({ ...base, sellerActive: false })).toBe(false);
    expect(localSellChecklistComplete({ ...base, githubConnected: false })).toBe(false);
    expect(localSellChecklistComplete({ ...base, tosAccepted: false })).toBe(false);
    expect(localSellChecklistComplete({ ...base, stripePayoutReady: false })).toBe(false);
  });
});

describe("mergeLocalSellChecklistSignals", () => {
  it("treats Local Vault setup as satisfying checklist rows", () => {
    const merged = mergeLocalSellChecklistSignals({
      linked: true,
      sellerActive: true,
      githubConnected: false,
      tosAccepted: false,
      stripePayoutReady: false,
      localGithubLogin: "dev",
      localTosAccepted: true,
      localPayoutReady: true,
    });
    expect(localSellChecklistComplete(merged)).toBe(true);
  });
});

describe("sellerLinkExchangeFromSearch (#706)", () => {
  it("reads the exchange code from the return query", () => {
    expect(
      sellerLinkExchangeFromSearch("?tab=seller&seller_link_exchange=slx_abc")
    ).toBe("slx_abc");
    expect(sellerLinkExchangeFromSearch("tab=seller")).toBeNull();
  });
});

describe("marketplaceCloudVaultMarketplaceUrl", () => {
  it("points at Cloud Personal Vault Marketplace", () => {
    expect(marketplaceCloudVaultMarketplaceUrl("https://app.godmode.software")).toBe(
      "https://app.godmode.software/vault?tab=marketplace"
    );
  });
});

describe("marketplaceSellerStorefrontUrl", () => {
  it("builds the marketing storefront path", () => {
    expect(marketplaceSellerStorefrontUrl("s_bq54l3pxqb")).toBe(
      "https://godmode.software/marketplace/s_bq54l3pxqb"
    );
    expect(marketplaceSellerStorefrontUrl("")).toBe("");
  });
});

describe("formatMarketplaceCents", () => {
  it("formats free and paid prices", () => {
    expect(formatMarketplaceCents(0)).toBe("Free");
    expect(formatMarketplaceCents(null)).toBe("Free");
    expect(formatMarketplaceCents(999)).toBe("$9.99");
  });
});

describe("officialCatalogEmptyMessage (#434)", () => {
  it("points Cloud operators at admin sync, not local catalog path", () => {
    expect(officialCatalogEmptyMessage(true)).toMatch(/platform admin/i);
    expect(officialCatalogEmptyMessage(true)).not.toMatch(/LOCAL_CATALOG/i);
  });

  it("keeps local-dev path hint off Cloud", () => {
    expect(officialCatalogEmptyMessage(false)).toMatch(/MARKETPLACE_LOCAL_CATALOG_PATH/);
  });
});

describe("Local tab on SaaS", () => {
  it("hides Local until the host is known to be self-host", () => {
    expect(marketplaceShowsLocalTab(null)).toBe(false);
    expect(marketplaceShowsLocalTab(true)).toBe(false);
    expect(marketplaceShowsLocalTab(false)).toBe(true);
  });

  it("rewrites Cloud Local and unofficial URLs to Community", () => {
    expect(normalizeMarketplaceTab("local", { saas: true })).toBe("community");
    expect(normalizeMarketplaceTab("unofficial", { saas: true })).toBe("community");
    expect(normalizeMarketplaceTab("local", { saas: false })).toBe("local");
    expect(normalizeMarketplaceTab("unofficial", { saas: false })).toBe("local");
  });

  it("points Cloud Installed empty copy at Official or Community", () => {
    expect(installedEmptyHint(true)).toMatch(/Official or Community/);
    expect(installedEmptyHint(true)).not.toMatch(/Local/);
    expect(installedEmptyHint(false)).toMatch(/Official, Community, or Local/);
  });
});

describe("userFacingErrorMessage", () => {
  it("uses a fallback when the error message is empty", () => {
    expect(userFacingErrorMessage(new Error(""), "Publish failed")).toBe("Publish failed");
    expect(userFacingErrorMessage(new Error("   "), "Publish failed")).toBe("Publish failed");
    expect(userFacingErrorMessage({}, "Publish failed")).toBe("Publish failed");
    expect(userFacingErrorMessage(new Error("Accept ToS first"), "Publish failed")).toBe(
      "Accept ToS first"
    );
  });
});

describe("listingStatusLabel", () => {
  it("maps listing statuses for the seller dashboard", () => {
    expect(listingStatusLabel("active")).toBe("Listed");
    expect(listingStatusLabel("in_review")).toBe("In review");
    expect(listingStatusLabel("draft")).toBe("Draft");
    expect(listingStatusLabel("pending_payout")).toBe("Pending · awaiting payment setup");
  });
});

describe("sellerPayoutStatusFromAccount", () => {
  it("hydrates Sell gating from commerce_config without Stripe refresh", () => {
    expect(sellerPayoutStatusFromAccount({ payoutReady: false })).toEqual({
      stripeConnectId: "",
      paypalMerchantId: "",
      metamaskAddress: "",
      payoutReady: false,
    });
    expect(
      sellerPayoutStatusFromAccount({
        stripeConnectAccountId: "acct_live",
        payoutReady: true,
        onboardingStatus: "pending",
      })
    ).toMatchObject({
      stripeConnectId: "acct_live",
      payoutReady: true,
    });
  });

  it("maps a Stripe refresh row after Connect return", () => {
    expect(
      sellerPayoutStatusFromAccount({
        stripe_connect_account_id: "acct_return",
        onboarding_status: "ready",
        stripe_payouts_enabled: true,
      })
    ).toMatchObject({
      stripeConnectId: "acct_return",
      payoutReady: true,
    });
  });

  it("unwraps kernel RecordRow data from refresh_stripe_connect", () => {
    expect(
      sellerPayoutStatusFromAccount({
        id: "sa-1",
        objectType: "MarketplaceSellerAccount",
        data: {
          id: "sa-1",
          stripe_connect_account_id: "acct_nested",
          onboarding_status: "pending",
        },
      })
    ).toMatchObject({
      stripeConnectId: "acct_nested",
      payoutReady: true,
    });
  });
});

describe("communityCheckoutBody", () => {
  it("sets listingId for Community checkout", () => {
    const body = communityCheckoutBody({
      listingId: "listing-1",
      provider: "stripe",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/cancel",
    });
    expect(body.listingId).toBe("listing-1");
    expect(body.provider).toBe("stripe");
    expect(body).not.toHaveProperty("catalogEntryId");
  });
});
