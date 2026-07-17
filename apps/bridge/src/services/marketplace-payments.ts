import { config } from "../config.js";
import type { CoreDatabase } from "../core-db.js";
import { resolveStripeSecretKey } from "./platform-billing.js";
import { verifyStripeWebhookSignature } from "./saas-entitlements.js";
import {
  createMarketplaceOrder,
  findOrderByProviderRef,
  getMarketplaceOrder,
  markOrderDisputedAndBanBuyer,
  markOrderPaid,
  markOrderProviderRef,
  MarketplaceCommerceError,
  type MarketplacePaymentProvider,
} from "./marketplace-commerce.js";

function stripeForm(params: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") body.set(k, v);
  }
  return body;
}

function paypalBaseUrl(): string {
  return config.marketplace.payments.paypalEnv === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken(): Promise<string> {
  const id = config.marketplace.payments.paypalClientId;
  const secret = config.marketplace.payments.paypalClientSecret;
  if (!id || !secret) {
    throw new MarketplaceCommerceError("PayPal is not configured", 503);
  }
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new MarketplaceCommerceError(`PayPal auth failed (${res.status})`, 502);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new MarketplaceCommerceError("PayPal auth missing token", 502);
  }
  return json.access_token;
}

export async function startMarketplaceCheckout(
  core: CoreDatabase,
  opts: {
    orderId: string;
    successUrl: string;
    cancelUrl: string;
    buyerEmail?: string;
    /** Stripe Connect destination for user listings (optional). */
    stripeConnectAccountId?: string | null;
    /** PayPal payee merchant id for user listings (optional). */
    paypalMerchantId?: string | null;
  }
): Promise<{
  provider: MarketplacePaymentProvider;
  url?: string;
  sessionId?: string;
  paypalOrderId?: string;
  crypto?: {
    treasuryAddress: string;
    chainId: number;
    asset: string;
    amountCents: number;
    orderId: string;
    memo: string;
  };
}> {
  const order = getMarketplaceOrder(core, opts.orderId);
  if (!order) throw new MarketplaceCommerceError("Order not found", 404);
  if (String(order.status) !== "awaiting_payment" && String(order.status) !== "pending") {
    throw new MarketplaceCommerceError(`Order is ${order.status}`, 409);
  }

  const amountCents = Number(order.amount_cents);
  const provider = String(order.provider) as MarketplacePaymentProvider;
  const currency = String(order.currency || "usd").toLowerCase();
  const feeCents = Number(order.platform_fee_cents ?? 0);
  const sellerKind = String(order.seller_kind) as "official" | "user";

  if (amountCents <= 0) {
    markOrderPaid(core, { orderId: opts.orderId, providerRef: "free" });
    return { provider, sessionId: "free" };
  }

  if (provider === "stripe") {
    const secret = resolveStripeSecretKey();
    if (!secret) throw new MarketplaceCommerceError("Stripe is not configured", 503);

    const params: Record<string, string> = {
      mode: "payment",
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      "line_items[0][price_data][currency]": currency,
      "line_items[0][price_data][unit_amount]": String(amountCents),
      "line_items[0][price_data][product_data][name]": `GodMode Marketplace ${opts.orderId}`,
      "line_items[0][quantity]": "1",
      "metadata[godmode_marketplace]": "1",
      "metadata[godmode_order_id]": opts.orderId,
      "payment_intent_data[metadata][godmode_marketplace]": "1",
      "payment_intent_data[metadata][godmode_order_id]": opts.orderId,
    };
    if (opts.buyerEmail?.trim()) {
      params.customer_email = opts.buyerEmail.trim().toLowerCase();
    }
    if (
      sellerKind === "user" &&
      opts.stripeConnectAccountId &&
      feeCents >= 0
    ) {
      params["payment_intent_data[application_fee_amount]"] = String(feeCents);
      params["payment_intent_data[transfer_data][destination]"] =
        opts.stripeConnectAccountId;
    }

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: stripeForm(params),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new MarketplaceCommerceError(`Stripe checkout failed: ${text}`, 502);
    }
    const json = (await res.json()) as { id?: string; url?: string };
    if (!json.id || !json.url) {
      throw new MarketplaceCommerceError("Stripe checkout missing session", 502);
    }
    markOrderProviderRef(core, opts.orderId, json.id);
    return { provider: "stripe", url: json.url, sessionId: json.id };
  }

  if (provider === "paypal") {
    const token = await paypalAccessToken();
    const body: Record<string, unknown> = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: opts.orderId,
          custom_id: opts.orderId,
          amount: {
            currency_code: currency.toUpperCase(),
            value: (amountCents / 100).toFixed(2),
          },
        },
      ],
      application_context: {
        return_url: opts.successUrl,
        cancel_url: opts.cancelUrl,
        user_action: "PAY_NOW",
      },
    };
    if (sellerKind === "user" && opts.paypalMerchantId) {
      const unit = (body.purchase_units as Array<Record<string, unknown>>)[0]!;
      unit.payee = { merchant_id: opts.paypalMerchantId };
      if (feeCents > 0) {
        unit.payment_instruction = {
          disbursement_mode: "INSTANT",
          platform_fees: [
            {
              amount: {
                currency_code: currency.toUpperCase(),
                value: (feeCents / 100).toFixed(2),
              },
            },
          ],
        };
      }
    }

    const res = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new MarketplaceCommerceError(`PayPal checkout failed: ${text}`, 502);
    }
    const json = (await res.json()) as {
      id?: string;
      links?: Array<{ rel?: string; href?: string }>;
    };
    const approve = json.links?.find((l) => l.rel === "approve")?.href;
    if (!json.id || !approve) {
      throw new MarketplaceCommerceError("PayPal checkout missing approve link", 502);
    }
    markOrderProviderRef(core, opts.orderId, json.id);
    return { provider: "paypal", url: approve, paypalOrderId: json.id };
  }

  if (provider === "crypto") {
    const treasury = config.marketplace.payments.cryptoTreasuryAddress;
    if (!treasury) {
      throw new MarketplaceCommerceError("Crypto treasury is not configured", 503);
    }
    markOrderProviderRef(core, opts.orderId, `crypto:${opts.orderId}`);
    return {
      provider: "crypto",
      crypto: {
        treasuryAddress: treasury,
        chainId: config.marketplace.payments.cryptoChainId,
        asset: config.marketplace.payments.cryptoAsset,
        amountCents,
        orderId: opts.orderId,
        memo: opts.orderId,
      },
    };
  }

  throw new MarketplaceCommerceError(`Unknown provider ${provider}`);
}

export function handleMarketplaceStripeWebhook(
  core: CoreDatabase,
  rawBody: Buffer,
  signatureHeader: string | undefined
): { ok: true; orderId?: string } | { ok: false; error: string; status: number } {
  const secret =
    config.marketplace.payments.stripeWebhookSecret ||
    (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    return { ok: false, error: "Marketplace Stripe webhook secret not configured", status: 503 };
  }
  if (!verifyStripeWebhookSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, error: "Invalid Stripe signature", status: 400 };
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody.toString("utf8")) as typeof event;
  } catch {
    return { ok: false, error: "Invalid JSON", status: 400 };
  }

  const obj = event.data?.object ?? {};
  const metadata = (obj.metadata ?? {}) as Record<string, string>;
  const orderId =
    metadata.godmode_order_id ||
    (typeof obj.client_reference_id === "string" ? obj.client_reference_id : undefined);

  if (event.type === "checkout.session.completed") {
    if (metadata.godmode_marketplace !== "1" && !orderId) {
      return { ok: true };
    }
    const sessionId = typeof obj.id === "string" ? obj.id : undefined;
    const order =
      (orderId ? getMarketplaceOrder(core, orderId) : undefined) ??
      (sessionId ? findOrderByProviderRef(core, "stripe", sessionId) : undefined);
    if (!order) return { ok: true };
    markOrderPaid(core, {
      orderId: String(order.id),
      providerRef: sessionId ?? String(order.provider_ref ?? ""),
    });
    return { ok: true, orderId: String(order.id) };
  }

  if (
    event.type === "charge.dispute.created" ||
    event.type === "charge.dispute.funds_withdrawn"
  ) {
    const paymentIntent =
      typeof obj.payment_intent === "string" ? obj.payment_intent : undefined;
    if (orderId) {
      markOrderDisputedAndBanBuyer(core, {
        orderId,
        reason: "chargeback",
      });
      return { ok: true, orderId };
    }
    if (paymentIntent) {
      const byRef = findOrderByProviderRef(core, "stripe", paymentIntent);
      if (byRef) {
        markOrderDisputedAndBanBuyer(core, {
          orderId: String(byRef.id),
          reason: "chargeback",
        });
        return { ok: true, orderId: String(byRef.id) };
      }
    }
    return { ok: true };
  }

  return { ok: true };
}

export async function capturePayPalOrder(
  core: CoreDatabase,
  paypalOrderId: string
): Promise<Record<string, unknown>> {
  const token = await paypalAccessToken();
  const res = await fetch(
    `${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new MarketplaceCommerceError(`PayPal capture failed: ${text}`, 502);
  }
  const json = (await res.json()) as {
    id?: string;
    status?: string;
    purchase_units?: Array<{ custom_id?: string; reference_id?: string }>;
  };
  const customId =
    json.purchase_units?.[0]?.custom_id || json.purchase_units?.[0]?.reference_id;
  const order =
    (customId ? getMarketplaceOrder(core, customId) : undefined) ??
    findOrderByProviderRef(core, "paypal", paypalOrderId);
  if (!order) {
    throw new MarketplaceCommerceError("Marketplace order not found for PayPal capture", 404);
  }
  if (json.status === "COMPLETED" || json.status === "APPROVED") {
    return markOrderPaid(core, {
      orderId: String(order.id),
      providerRef: paypalOrderId,
    });
  }
  return order;
}

export function confirmCryptoPayment(
  core: CoreDatabase,
  opts: { orderId: string; txHash: string; buyerUserId: string }
): Record<string, unknown> {
  const order = getMarketplaceOrder(core, opts.orderId);
  if (!order) throw new MarketplaceCommerceError("Order not found", 404);
  if (String(order.buyer_user_id) !== opts.buyerUserId) {
    throw new MarketplaceCommerceError("Forbidden", 403);
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(opts.txHash)) {
    throw new MarketplaceCommerceError("Invalid transaction hash");
  }
  // v1: accept reported tx hash after buyer pays to treasury; ops can reconcile on-chain.
  return markOrderPaid(core, {
    orderId: opts.orderId,
    providerRef: `crypto:${opts.orderId}`,
    cryptoTxHash: opts.txHash,
  });
}

export function handleMarketplacePayPalWebhook(
  core: CoreDatabase,
  body: Record<string, unknown>
): { ok: true; orderId?: string } {
  const eventType = String(body.event_type ?? "");
  const resource = (body.resource ?? {}) as Record<string, unknown>;

  if (
    eventType === "CHECKOUT.ORDER.APPROVED" ||
    eventType === "PAYMENT.CAPTURE.COMPLETED"
  ) {
    const customId =
      typeof resource.custom_id === "string"
        ? resource.custom_id
        : typeof (resource.purchase_units as Array<{ custom_id?: string }> | undefined)?.[0]
              ?.custom_id === "string"
          ? (resource.purchase_units as Array<{ custom_id?: string }>)[0]!.custom_id
          : undefined;
    const providerRef =
      typeof resource.id === "string"
        ? resource.id
        : typeof resource.supplementary_data === "object" &&
            resource.supplementary_data &&
            typeof (resource.supplementary_data as { related_ids?: { order_id?: string } })
              .related_ids?.order_id === "string"
          ? (resource.supplementary_data as { related_ids: { order_id: string } }).related_ids
              .order_id
          : undefined;

    const order =
      (customId ? getMarketplaceOrder(core, customId) : undefined) ??
      (providerRef ? findOrderByProviderRef(core, "paypal", providerRef) : undefined);
    if (order) {
      markOrderPaid(core, {
        orderId: String(order.id),
        providerRef: providerRef ?? String(order.provider_ref ?? ""),
      });
      return { ok: true, orderId: String(order.id) };
    }
  }

  if (
    eventType === "CUSTOMER.DISPUTE.CREATED" ||
    eventType === "CUSTOMER.DISPUTE.RESOLVED"
  ) {
    const disputed = resource as {
      disputed_transactions?: Array<{ custom?: string; seller_transaction_id?: string }>;
    };
    const custom = disputed.disputed_transactions?.[0]?.custom;
    if (custom) {
      markOrderDisputedAndBanBuyer(core, { orderId: custom, reason: "chargeback" });
      return { ok: true, orderId: custom };
    }
  }

  return { ok: true };
}

export function createOrderForListing(
  core: CoreDatabase,
  opts: {
    listing: Record<string, unknown>;
    buyerUserId: string;
    buyerTenantId: string;
    provider: MarketplacePaymentProvider;
  }
): Record<string, unknown> {
  const sellerKind = (String(opts.listing.seller_kind || "user") as "official" | "user");
  return createMarketplaceOrder(core, {
    listingId: String(opts.listing.id),
    catalogEntryId:
      typeof opts.listing.catalog_entry_id === "string"
        ? opts.listing.catalog_entry_id
        : null,
    buyerUserId: opts.buyerUserId,
    buyerTenantId: opts.buyerTenantId,
    sellerUserId: String(opts.listing.seller_user_id),
    sellerKind,
    amountCents: Number(opts.listing.price_cents ?? 0),
    currency: String(opts.listing.currency || "usd"),
    provider: opts.provider,
  });
}

export function createOrderForOfficialCatalogEntry(
  core: CoreDatabase,
  opts: {
    entryId: string;
    priceCents: number;
    currency?: string;
    buyerUserId: string;
    buyerTenantId: string;
    provider: MarketplacePaymentProvider;
    listingId?: string | null;
  }
): Record<string, unknown> {
  return createMarketplaceOrder(core, {
    listingId: opts.listingId ?? null,
    catalogEntryId: opts.entryId,
    buyerUserId: opts.buyerUserId,
    buyerTenantId: opts.buyerTenantId,
    sellerUserId: null,
    sellerKind: "official",
    amountCents: opts.priceCents,
    currency: opts.currency ?? "usd",
    provider: opts.provider,
  });
}
