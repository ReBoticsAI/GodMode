import { describe, expect, it } from "vitest";
import { buildPublicListingsSql, LISTING_COLS } from "../../routes/marketplace.js";

describe("buildPublicListingsSql", () => {
  it("excludes plugin listings from public browse (catalog shelf is the buyer path)", () => {
    const { sql } = buildPublicListingsSql({});
    expect(sql).toMatch(/ml\.kind != 'plugin'/);
    expect(sql).toMatch(/ml\.status='active'/);
  });

  it("includes commerce columns in LISTING_COLS", () => {
    expect(LISTING_COLS).toContain("price_cents");
    expect(LISTING_COLS).toContain("currency");
    expect(LISTING_COLS).toContain("seller_kind");
    expect(LISTING_COLS).toContain("catalog_entry_id");
    expect(LISTING_COLS).toContain("updated_at");
  });

  it("joins seller verified_tier for Community browse", () => {
    const { sql } = buildPublicListingsSql({});
    expect(sql).toContain("verified_publisher");
    expect(sql).toContain("verified_tier");
    expect(sql).toContain("payout_ready");
    expect(sql).toContain("marketplace_seller_accounts");
    expect(sql).toMatch(/ml\.seller_kind=\?/);
  });

  it("defaults to seller_kind=user for Community browse", () => {
    const { sql, params } = buildPublicListingsSql({});
    expect(sql).toMatch(/ml\.seller_kind=\?/);
    expect(params).toEqual(["user"]);
  });

  it("excludes official seller_kind when filtering user listings", () => {
    const { sql, params } = buildPublicListingsSql({ sellerKind: "user" });
    expect(sql).toMatch(/ml\.seller_kind=\?/);
    expect(params[0]).toBe("user");
    expect(params).not.toContain("official");
  });

  it("allows seller_kind=all to skip the seller filter", () => {
    const { sql, params } = buildPublicListingsSql({ sellerKind: "all" });
    expect(sql).not.toMatch(/seller_kind=\?/);
    expect(params).toEqual([]);
  });

  it("combines kind filter with seller_kind", () => {
    const { sql, params } = buildPublicListingsSql({
      sellerKind: "user",
      kind: "skill",
    });
    expect(sql).toMatch(/ml\.seller_kind=\?/);
    expect(sql).toMatch(/ml\.kind=\?/);
    expect(params).toEqual(["user", "skill"]);
  });
});
