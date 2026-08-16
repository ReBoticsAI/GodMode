import { describe, expect, it } from "vitest";
import {
  attachListingIdToCatalogEntry,
  communityPluginInstallBlock,
  isCommunityCatalogSource,
  resolveListingPublishState,
  sellerOwnsCatalogEntry,
} from "../marketplace-listing-policy.js";

describe("sellerOwnsCatalogEntry", () => {
  it("matches GitHub login to catalog author and pluginRepo", () => {
    expect(sellerOwnsCatalogEntry({ author: "DaneSchell" }, "daneschell")).toBe(true);
    expect(
      sellerOwnsCatalogEntry(
        { author: "Dane Schell", pluginRepo: "https://github.com/DaneSchell/godmode-workspace-pulse" },
        "DaneSchell"
      )
    ).toBe(true);
    expect(sellerOwnsCatalogEntry({ author: "other" }, "DaneSchell")).toBe(false);
  });
});

describe("resolveListingPublishState", () => {
  it("activates CI-backed plugin listings when free or payout-ready", () => {
    expect(
      resolveListingPublishState({
        kind: "plugin",
        catalogEntryId: "workspace-pulse",
        priceCents: 0,
      })
    ).toEqual({ status: "active", visibility: "public" });
    expect(
      resolveListingPublishState({
        kind: "plugin",
        catalogEntryId: "workspace-pulse",
        priceCents: 999,
        payoutReady: true,
      }).status
    ).toBe("active");
    expect(
      resolveListingPublishState({
        kind: "plugin",
        catalogEntryId: "workspace-pulse",
        priceCents: 999,
        payoutReady: false,
      }).status
    ).toBe("draft");
  });

  it("sends clone and live kinds to review", () => {
    expect(resolveListingPublishState({ kind: "agent" })).toEqual({
      status: "in_review",
      visibility: "private",
    });
    expect(resolveListingPublishState({ kind: "page" })).toEqual({
      status: "in_review",
      visibility: "private",
    });
  });

  it("rejects inference on SaaS", () => {
    const row = resolveListingPublishState({ kind: "inference", isSaas: true });
    expect(row.error).toMatch(/not available on GodMode Cloud/i);
  });
});

describe("communityPluginInstallBlock", () => {
  it("fail-closes paid Community plugins without an active listing", () => {
    expect(communityPluginInstallBlock({ priceCents: 500 })).toMatch(/no seller listing/i);
    expect(
      communityPluginInstallBlock({
        priceCents: 500,
        listingId: "lst-1",
        listingStatus: "in_review",
      })
    ).toMatch(/not public/i);
    expect(
      communityPluginInstallBlock({
        priceCents: 0,
        listingId: "lst-1",
        listingStatus: "active",
      })
    ).toBeNull();
  });
});

describe("isCommunityCatalogSource", () => {
  it("detects the Community catalog URL path", () => {
    expect(
      isCommunityCatalogSource(
        "https://raw.githubusercontent.com/ReBoticsAI/GodMode-Marketplace/main/catalog/community/index.json"
      )
    ).toBe(true);
    expect(isCommunityCatalogSource("https://example/catalog/official/index.json")).toBe(false);
  });
});

describe("attachListingIdToCatalogEntry", () => {
  it("joins catalog id to listing id", () => {
    const map = new Map([["pulse", "listing-1"]]);
    expect(attachListingIdToCatalogEntry({ id: "pulse" }, map).listingId).toBe("listing-1");
  });
});
