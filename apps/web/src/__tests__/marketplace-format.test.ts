import { describe, expect, it } from "vitest";
import {
  communityCheckoutBody,
  formatMarketplaceCents,
} from "@/lib/marketplace-format";

describe("formatMarketplaceCents", () => {
  it("formats free and paid prices", () => {
    expect(formatMarketplaceCents(0)).toBe("Free");
    expect(formatMarketplaceCents(null)).toBe("Free");
    expect(formatMarketplaceCents(999)).toBe("$9.99");
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
