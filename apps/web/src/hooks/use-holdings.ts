import { useCallback, useEffect, useState } from "react";
import {
  fetchHoldings,
  fetchHoldingsConfig,
  type HoldingsConfig,
  type HoldingsListResponse,
} from "../lib/api-holdings";

let cached: HoldingsListResponse | null = null;
let configCached: HoldingsConfig | null = null;
const listeners = new Set<(d: HoldingsListResponse | null) => void>();
const configListeners = new Set<(c: HoldingsConfig | null) => void>();

async function pull(): Promise<void> {
  try {
    const [data, config] = await Promise.all([
      fetchHoldings(),
      fetchHoldingsConfig(),
    ]);
    cached = data;
    configCached = config;
    for (const fn of listeners) fn(data);
    for (const fn of configListeners) fn(config);
  } catch {
    for (const fn of listeners) fn(cached);
    for (const fn of configListeners) fn(configCached);
  }
}

export function useHoldings(): {
  data: HoldingsListResponse | null;
  config: HoldingsConfig | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<HoldingsListResponse | null>(cached);
  const [config, setConfig] = useState<HoldingsConfig | null>(configCached);
  const [loading, setLoading] = useState(!cached);

  const refresh = useCallback(async () => {
    setLoading(true);
    await pull();
    setLoading(false);
  }, []);

  useEffect(() => {
    listeners.add(setData);
    configListeners.add(setConfig);
    if (!cached) {
      void refresh();
    } else {
      void pull();
    }
    return () => {
      listeners.delete(setData);
      configListeners.delete(setConfig);
    };
  }, [refresh]);

  return { data, config, loading, refresh };
}
