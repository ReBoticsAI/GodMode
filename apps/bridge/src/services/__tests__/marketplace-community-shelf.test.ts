import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../config.js";
import {
  resolveCommunityCatalogUrl,
  resolveOfficialCatalogUrl,
  resetMarketplaceCatalogCacheForTests,
} from "../marketplace-catalog.js";
import {
  applyCommunityCommerceOverlay,
  fetchRemoteCommunityShelf,
  mergePublicListings,
  resetRemoteCommunityShelfCacheForTests,
} from "../marketplace-community-shelf.js";
import { PROTOCOL_EXCEPTIONS } from "../../kernel/protocol-exceptions.js";

const previousOfficialPath = config.marketplace.localCatalogPath;
const previousCommunityPath = config.marketplace.localCommunityCatalogPath;
const previousCommunityUrl = config.marketplace.communityUrl;
const previousOfficialUrl = config.marketplace.officialUrl;
const previousSaasCommunity = config.marketplace.saasCommunityCatalogUrl;
const previousTtl = config.marketplace.cacheTtlMs;
const previousTimeout = config.marketplace.catalogFetchTimeoutMs;
const previousIsSaas = config.isSaas;

afterEach(() => {
  config.marketplace.localCatalogPath = previousOfficialPath;
  config.marketplace.localCommunityCatalogPath = previousCommunityPath;
  config.marketplace.communityUrl = previousCommunityUrl;
  config.marketplace.officialUrl = previousOfficialUrl;
  config.marketplace.saasCommunityCatalogUrl = previousSaasCommunity;
  config.marketplace.cacheTtlMs = previousTtl;
  config.marketplace.catalogFetchTimeoutMs = previousTimeout;
  config.isSaas = previousIsSaas;
  resetMarketplaceCatalogCacheForTests();
  resetRemoteCommunityShelfCacheForTests();
  vi.unstubAllGlobals();
});

describe("marketplace catalog URL resolution", () => {
  it("uses GitHub Official and Community indexes when no explicit file override is set", () => {
    config.marketplace.localCatalogPath = "";
    config.marketplace.localCommunityCatalogPath = "";
    config.marketplace.officialUrl =
      "https://raw.githubusercontent.com/ReBoticsAI/GodMode-Marketplace/main/catalog/official/index.json";
    config.marketplace.communityUrl =
      "https://raw.githubusercontent.com/ReBoticsAI/GodMode-Marketplace/main/catalog/community/index.json";
    expect(resolveOfficialCatalogUrl()).toMatch(/catalog\/official\/index\.json$/);
    expect(resolveCommunityCatalogUrl()).toMatch(/catalog\/community\/index\.json$/);
    expect(resolveOfficialCatalogUrl()).not.toMatch(/^file:/);
    expect(resolveCommunityCatalogUrl()).not.toMatch(/^file:/);
  });
});

describe("community commerce overlay", () => {
  it("copies Cloud listing id and price onto GitHub catalog entries", () => {
    const merged = applyCommunityCommerceOverlay(
      [
        {
          id: "community-ping",
          kind: "plugin",
          installType: "plugin",
          title: "Community Ping",
          description: "",
          version: "0.1.0",
          author: "community-author",
        },
      ],
      [
        {
          id: "community-ping",
          kind: "plugin",
          installType: "plugin",
          title: "Community Ping",
          description: "",
          version: "0.1.0",
          author: "community-author",
          listingId: "lst-cloud",
          listingStatus: "active",
          priceCents: 0,
        },
      ]
    );
    expect(merged[0]?.listingId).toBe("lst-cloud");
    expect(merged[0]?.listingStatus).toBe("active");
    expect(merged[0]?.commerceHost).toBe("cloud");
  });

  it("prefers Cloud listing id when Local and Cloud both have a listing", () => {
    const merged = applyCommunityCommerceOverlay(
      [
        {
          id: "workspace-pulse",
          kind: "plugin",
          installType: "plugin",
          title: "Workspace Pulse",
          description: "",
          version: "0.1.0",
          author: "seller",
          listingId: "lst-local",
          listingStatus: "active",
          priceCents: 100,
        },
      ],
      [
        {
          id: "workspace-pulse",
          kind: "plugin",
          installType: "plugin",
          title: "Workspace Pulse",
          description: "",
          version: "0.1.0",
          author: "seller",
          listingId: "lst-cloud",
          listingStatus: "active",
          priceCents: 100,
        },
      ]
    );
    expect(merged[0]?.listingId).toBe("lst-cloud");
    expect(merged[0]?.commerceHost).toBe("cloud");
  });

  it("keeps local listings first and tags remote Cloud rows", () => {
    const merged = mergePublicListings(
      [{ id: "local-1", title: "Local skill" }],
      [{ id: "cloud-1", title: "Cloud skill" }]
    );
    expect(merged.map((row) => row.id)).toEqual(["local-1", "cloud-1"]);
    expect(merged[1]?.commerce_host).toBe("cloud");
  });

  it("does not fetch the Cloud Community shelf on SaaS", async () => {
    config.isSaas = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchRemoteCommunityShelf()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty shelf when Cloud is down so GitHub catalog still loads", async () => {
    config.isSaas = false;
    config.marketplace.saasCommunityCatalogUrl = "https://example.test/community/public";
    config.marketplace.catalogFetchTimeoutMs = 40;
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 502 }));
    const shelf = await fetchRemoteCommunityShelf();
    expect(shelf?.entries).toEqual([]);
    expect(shelf?.listings).toEqual([]);
  });
});

describe("marketplace community public protocol exception", () => {
  it("registers GET /api/marketplace/commerce/catalog/community/public", () => {
    const hit = PROTOCOL_EXCEPTIONS.find((e) => e.id === "marketplace-community-catalog-public");
    expect(hit?.methods).toContain("GET");
    expect(hit?.pathPattern).toBe("/api/marketplace/commerce/catalog/community/public");
  });
});
