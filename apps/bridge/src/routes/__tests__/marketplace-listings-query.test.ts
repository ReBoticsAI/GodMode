import { describe, expect, it } from "vitest";
import { buildPublicListingsSql, LISTING_COLS } from "../../routes/marketplace.js";

describe("buildPublicListingsSql", () => {
  it("includes commerce columns in LISTING_COLS", () => {
    expect(LISTING_COLS).toContain("price_cents");
    expect(LISTING_COLS).toContain("currency");
    expect(LISTING_COLS).toContain("seller_kind");
    expect(LISTING_COLS).toContain("catalog_entry_id");
    expect(LISTING_COLS).toContain("updated_at");
  });

  it("defaults to seller_kind=user for Community browse", () => {
    const { sql, params } = buildPublicListingsSql({});
    expect(sql).toContain("seller_kind=?");
    expect(params).toEqual(["user"]);
  });

  it("excludes official seller_kind when filtering user listings", () => {
    const { sql, params } = buildPublicListingsSql({ sellerKind: "user" });
    expect(sql).toMatch(/seller_kind=\?/);
    expect(params[0]).toBe("user");
    expect(params).not.toContain("official");
  });

  it("allows seller_kind=all to skip the seller filter", () => {
    const { sql, params } = buildPublicListingsSql({ sellerKind: "all" });
    expect(sql).not.toContain("seller_kind=?");
    expect(params).toEqual([]);
  });

  it("combines kind filter with seller_kind", () => {
    const { sql, params } = buildPublicListingsSql({
      sellerKind: "user",
      kind: "skill",
    });
    expect(sql).toContain("seller_kind=?");
    expect(sql).toContain("kind=?");
    expect(params).toEqual(["user", "skill"]);
  });
});
