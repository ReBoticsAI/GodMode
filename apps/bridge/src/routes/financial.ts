import type { Request } from "express";
import { Router } from "express";
import { requireEditorForMutation } from "../services/auth/middleware.js";
import type { AppDatabase } from "../db.js";
import { getReqTenantDb } from "../services/auth/middleware.js";
import { CredentialStore } from "../services/holdings/credential-store.js";
import { HoldingsService } from "../services/holdings/holdings-service.js";
import { CryptoProvider } from "../services/holdings/crypto-provider.js";
import { PayPalService } from "../services/holdings/paypal-service.js";
import { config } from "../config.js";
import { usdToCad } from "../services/holdings/fx-service.js";

export interface FinancialDeps {
  credentials: CredentialStore;
  holdings: HoldingsService;
  crypto: CryptoProvider;
  paypal: PayPalService;
}

export function createFinancialServices(db: AppDatabase): FinancialDeps {
  const credentials = new CredentialStore(db);
  const holdings = new HoldingsService(db);
  const crypto = new CryptoProvider(credentials);
  const paypal = new PayPalService(credentials);
  return { credentials, holdings, crypto, paypal };
}

function financialDeps(req: Request): FinancialDeps {
  return createFinancialServices(getReqTenantDb(req));
}

/** @deprecated use financialDeps(req) per request */
export function createFinancialRouter(_db?: AppDatabase, _deps?: FinancialDeps): Router {
  const router = Router();
  router.use(requireEditorForMutation);

  router.get("/config", (req, res) => {
    const { credentials } = financialDeps(req);
    res.json({
      ...credentials.configStatus(),
      chains: config.holdings.cryptoChains,
    });
  });

  router.post("/config/moralis", async (req, res) => {
    const { credentials, crypto } = financialDeps(req);
    const apiKey = String((req.body as { apiKey?: string })?.apiKey ?? "").trim();
    if (!apiKey) return res.status(400).json({ error: "apiKey required" });
    credentials.setMoralisApiKey(apiKey);
    const test = await crypto.testConnection();
    if (!test.ok) {
      return res.status(400).json({ error: test.error ?? "Moralis key rejected" });
    }
    res.json({ ok: true, configured: true });
  });

  router.post("/config/paypal", async (req, res) => {
    const { credentials, paypal } = financialDeps(req);
    const body = req.body as {
      clientId?: string;
      clientSecret?: string;
      env?: string;
    };
    const clientId = String(body.clientId ?? "").trim();
    const clientSecret = String(body.clientSecret ?? "").trim();
    const env = body.env === "live" ? "live" : "sandbox";
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: "clientId and clientSecret required" });
    }
    credentials.setPayPalCredentials({ clientId, clientSecret, env });
    const test = await paypal.testConnection();
    if (!test.ok) {
      return res.status(400).json({ error: test.error ?? "PayPal credentials rejected" });
    }
    res.json({ ok: true, configured: true, env });
  });

  router.get("/connections", (req, res) => {
    const { holdings } = financialDeps(req);
    const list = holdings.list();
    res.json({
      connections: list,
      netWorthCad: holdings.netWorthCad(),
    });
  });

  router.post("/connections", async (req, res) => {
    const { holdings } = financialDeps(req);
    const body = req.body as {
      category?: string;
      provider?: string;
      label?: string;
      balance?: number;
      currency?: string;
      reference?: string;
    };
    if (!body.category || !body.provider || !body.label) {
      return res.status(400).json({ error: "category, provider, label required" });
    }
    const balance = Number(body.balance ?? 0);
    const currency = String(body.currency ?? "CAD").toUpperCase();
    let balanceCad = balance;
    if (currency === "USD") {
      balanceCad = await usdToCad(balance);
    }
    const conn = holdings.create({
      category: body.category as "manual",
      provider: body.provider,
      label: body.label,
      currency,
      reference: body.reference,
      balance,
      balanceCad,
      status: "active",
    });
    res.json(conn);
  });

  router.delete("/connections/:id", (req, res) => {
    const { holdings } = financialDeps(req);
    const ok = holdings.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, netWorthCad: holdings.netWorthCad() });
  });

  router.post("/connections/:id/refresh", async (req, res) => {
    const { holdings, crypto, paypal } = financialDeps(req);
    const conn = holdings.get(req.params.id);
    if (!conn) return res.status(404).json({ error: "not found" });

    try {
      if (conn.category === "wallet" && conn.reference) {
        const portfolio = await crypto.fetchPortfolio(conn.reference);
        const updated = holdings.updateBalance(
          conn.id,
          portfolio.totalUsd,
          "USD",
          portfolio.totalCad,
          { tokens: portfolio.tokens }
        );
        return res.json(updated);
      }
      if (conn.category === "paypal") {
        const balance = await paypal.fetchBalance();
        const updated = holdings.updateBalance(
          conn.id,
          balance.total,
          balance.currency,
          balance.totalCad,
          balance.raw
        );
        return res.json(updated);
      }
      return res.status(400).json({ error: "Refresh not supported for this connection type" });
    } catch (err) {
      holdings.updateBalance(conn.id, conn.balance, conn.currency, conn.balanceCad, conn.breakdown, "error");
      return res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/crypto/balance", async (req, res) => {
    const { crypto } = financialDeps(req);
    const body = req.body as { address?: string; chains?: string[] };
    const address = String(body.address ?? "").trim();
    if (!address) return res.status(400).json({ error: "address required" });
    try {
      const portfolio = await crypto.fetchPortfolio(address, body.chains);
      res.json(portfolio);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/crypto/connect", async (req, res) => {
    const { crypto, holdings } = financialDeps(req);
    const body = req.body as {
      address?: string;
      provider?: string;
      label?: string;
      chains?: string[];
    };
    const address = String(body.address ?? "").trim();
    const provider = String(body.provider ?? "metamask");
    const label = String(body.label ?? provider).trim();
    if (!address) return res.status(400).json({ error: "address required" });
    try {
      const portfolio = await crypto.fetchPortfolio(address, body.chains);
      const conn = holdings.upsertCryptoWallet(provider, label, portfolio);
      res.json({ connection: conn, portfolio });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/paypal/connect", async (req, res) => {
    const { paypal, holdings } = financialDeps(req);
    const label = String((req.body as { label?: string })?.label ?? "PayPal Business").trim();
    try {
      const balance = await paypal.fetchBalance();
      const conn = holdings.upsertPayPal(label, balance);
      res.json({ connection: conn, balance });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
