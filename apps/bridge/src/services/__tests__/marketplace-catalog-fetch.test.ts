import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../config.js";
import {
  fetchCatalogIndex,
  resetMarketplaceCatalogCacheForTests,
} from "../marketplace-catalog.js";

const catalogUrl = "https://example.test/catalog/community/index.json";
const previousTimeout = config.marketplace.catalogFetchTimeoutMs;
const previousTtl = config.marketplace.cacheTtlMs;

afterEach(() => {
  resetMarketplaceCatalogCacheForTests();
  config.marketplace.catalogFetchTimeoutMs = previousTimeout;
  config.marketplace.cacheTtlMs = previousTtl;
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init?: { status?: number; etag?: string }): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init?.etag) headers.set("etag", init.etag);
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers });
}

function abortingHang(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    const fail = () => {
      reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

describe("marketplace catalog fetch", () => {
  it("times out instead of hanging the origin", async () => {
    config.marketplace.catalogFetchTimeoutMs = 40;
    vi.stubGlobal("fetch", abortingHang);
    await expect(fetchCatalogIndex(catalogUrl)).rejects.toThrow(/timed out/i);
  });

  it("coalesces in-flight fetches for the same catalog URL", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return jsonResponse({ version: 1, entries: [{ id: "community-ping" }] });
    });
    const [a, b] = await Promise.all([
      fetchCatalogIndex(catalogUrl),
      fetchCatalogIndex(catalogUrl),
    ]);
    expect(calls).toBe(1);
    expect(a.entries[0]?.id).toBe("community-ping");
    expect(b.entries[0]?.id).toBe("community-ping");
  });

  it("serves stale cache when a refresh fails", async () => {
    config.marketplace.cacheTtlMs = 20;
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ version: 1, entries: [{ id: "community-ping" }] });
      }
      return jsonResponse({ error: "upstream" }, { status: 502 });
    });
    const first = await fetchCatalogIndex(catalogUrl);
    expect(first.entries[0]?.id).toBe("community-ping");
    await new Promise((r) => setTimeout(r, 30));
    const stale = await fetchCatalogIndex(catalogUrl);
    expect(stale.entries[0]?.id).toBe("community-ping");
    expect(calls).toBe(2);
  });
});
