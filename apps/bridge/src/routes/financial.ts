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

  router.get("/connections", (req, res) => {
    const { holdings } = financialDeps(req);
    const list = holdings.list();
    res.json({
      connections: list,
      netWorthCad: holdings.netWorthCad(),
    });
  });

  return router;
}
