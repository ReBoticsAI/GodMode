import { describe, expect, it } from "vitest";
import {
  attachListingCommerceToCatalogEntry,
  attachListingIdToCatalogEntry,
  communityPluginInstallBlock,
  isCommunityCatalogSource,
  listingKindFromCatalogEntry,
  resolveListingPublishState,
  sellerOwnsCatalogEntry,
} from "../marketplace-listing-policy.js";

describe("sellerOwnsCatalogEntry", () => {
  it("matches GitHub login to catalog author and pluginRepo", () => {
    expect(sellerOwnsCatalogEntry({ author: "alice" }, "Alice")).toBe(true);
    expect(
      sellerOwnsCatalogEntry(
        { author: "Alice Example", pluginRepo: "https://github.com/alice/example-plugin" },
        "alice"
      )
    ).toBe(true);
    expect(sellerOwnsCatalogEntry({ author: "other" }, "alice")).toBe(false);
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
      })
    ).toEqual({ status: "pending_payout", visibility: "unlisted" });
  });

  it("activates catalog-backed clone packs and rejects uncatalogued clone/live", () => {
    expect(
      resolveListingPublishState({
        kind: "skill",
        catalogEntryId: "weekly-review-pack",
        priceCents: 0,
      })
    ).toEqual({ status: "active", visibility: "public" });
    expect(resolveListingPublishState({ kind: "agent" }).error).toMatch(/catalog entry id/i);
    expect(resolveListingPublishState({ kind: "page" }).error).toMatch(/catalog entry id/i);
    expect(
      resolveListingPublishState({ kind: "agent", deliveryMode: "live" }).error
    ).toMatch(/Live share listings require a Community catalog/i);
    expect(
      resolveListingPublishState({
        kind: "agent",
        deliveryMode: "live",
        catalogEntryId: "live-pack",
        priceCents: 0,
      })
    ).toEqual({ status: "active", visibility: "public" });
  });

  it("keeps hub inference on the review path when not SaaS", () => {
    expect(resolveListingPublishState({ kind: "inference", isSaas: false })).toEqual({
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
    expect(communityPluginInstallBlock({ priceCents: 0 })).toBeNull();
  });
});

describe("listingKindFromCatalogEntry", () => {
  it("maps catalog clone entries to pack kinds and plugins to plugin", () => {
    expect(
      listingKindFromCatalogEntry({ installType: "clone", kind: "skill" })
    ).toBe("skill");
    expect(listingKindFromCatalogEntry({ installType: "plugin", kind: "plugin" })).toBe(
      "plugin"
    );
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

describe("attachListingCommerceToCatalogEntry", () => {
  it("merges listing commerce onto catalog rows without overwriting non-zero catalog price", () => {
    const map = new Map([
      [
        "pulse",
        { id: "listing-1", priceCents: 500, currency: "usd", status: "active" },
      ],
    ]);
    const merged = attachListingCommerceToCatalogEntry(
      { id: "pulse", priceCents: 100, currency: "eur" },
      map
    );
    expect(merged.listingId).toBe("listing-1");
    expect(merged.priceCents).toBe(100);
    expect(merged.currency).toBe("eur");
    expect(merged.listingStatus).toBe("active");
  });

  it("fills price and currency from listing when catalog row has none", () => {
    const map = new Map([
      ["pulse", { id: "listing-1", priceCents: 500, currency: "usd", status: "draft" }],
    ]);
    const merged = attachListingCommerceToCatalogEntry({ id: "pulse" }, map);
    expect(merged.priceCents).toBe(500);
    expect(merged.currency).toBe("usd");
    expect(merged.listingStatus).toBe("draft");
  });

  it("keeps Cloud checkout listing id when commerceHost is cloud", () => {
    const map = new Map([
      [
        "pulse",
        { id: "listing-local", priceCents: 100, currency: "usd", status: "active" },
      ],
    ]);
    const merged = attachListingCommerceToCatalogEntry(
      {
        id: "pulse",
        listingId: "listing-cloud",
        commerceHost: "cloud",
        priceCents: 100,
      },
      map
    );
    expect(merged.listingId).toBe("listing-cloud");
    expect(merged.listingStatus).toBe("active");
  });
});
