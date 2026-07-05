import { fetchJson } from "../../lib/rate-limit.js";

interface FxResponse {
  result?: string;
  rates?: Record<string, number>;
}

const CACHE_MS = 60 * 60 * 1000;
let cachedUsdCad: { rate: number; at: number } | null = null;

/** USD -> CAD conversion rate (cached 1h). */
export async function getUsdToCad(): Promise<number> {
  if (cachedUsdCad && Date.now() - cachedUsdCad.at < CACHE_MS) {
    return cachedUsdCad.rate;
  }
  const data = await fetchJson<FxResponse>(
    "https://open.er-api.com/v6/latest/USD"
  );
  const rate = data?.rates?.CAD;
  if (!rate || !Number.isFinite(rate)) {
    if (cachedUsdCad) return cachedUsdCad.rate;
    return 1.36;
  }
  cachedUsdCad = { rate, at: Date.now() };
  return rate;
}

export async function usdToCad(usd: number): Promise<number> {
  return usd * (await getUsdToCad());
}

export async function cadToUsd(cad: number): Promise<number> {
  const rate = await getUsdToCad();
  return cad / rate;
}
