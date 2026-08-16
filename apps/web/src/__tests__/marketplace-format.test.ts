import { describe, expect, it } from "vitest";
import {
  communityCheckoutBody,
  formatMarketplaceCents,
  installedEmptyHint,
  listingStatusLabel,
  marketplaceShowsLocalTab,
  normalizeMarketplaceTab,
  officialCatalogEmptyMessage,
} from "@/lib/marketplace-format";

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
    expect(installedEmptyHint(false)).toMatch(/Official or Local/);
  });
});

describe("listingStatusLabel", () => {
  it("maps listing statuses for the seller dashboard", () => {
    expect(listingStatusLabel("active")).toBe("Listed");
    expect(listingStatusLabel("in_review")).toBe("In review");
    expect(listingStatusLabel("draft")).toBe("Draft");
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
