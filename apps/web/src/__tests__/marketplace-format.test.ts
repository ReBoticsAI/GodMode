import { describe, expect, it } from "vitest";
import {
  communityCheckoutBody,
  formatMarketplaceCents,
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
