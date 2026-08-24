# Marketplace Terms of Service

**Version:** 2 (override with `MARKETPLACE_TOS_VERSION`)

These terms apply to buying and selling on the GodMode Marketplace (Official catalog and user listings). SaaS Cloud subscription terms are separate. Operator: ReBotics AI.

## Official vs Community

- **Official** ReBotics/GodMode catalog items: merchant of record is ReBotics/GodMode; revenue is **100%** to the platform.
- **Community** (user) listings: the transaction is between seller and buyer and settles through the payment processor. The platform takes a **10%** fee; the remainder goes to the seller via their connected payout rail (Stripe Connect, PayPal, or MetaMask).

## Stripe Connect (Community sellers)

When you sell Community listings with **Stripe Connect** checkout:

1. **You are the merchant of record** for the buyer relationship on that charge. Buyers pay your Stripe Connect account (direct charge). GodMode collects a **10%** platform application fee; the remainder stays in your connected Stripe balance according to Stripe Connect and GodMode payout settings.
2. **You are responsible** for listing accuracy, delivery or live access as advertised, tax and legal compliance in your jurisdictions, and responding to buyer disputes that Stripe or the buyer routes to you as seller.
3. **Chargebacks and disputes** on Community Connect sales are primarily between buyer and seller. GodMode may delist listings, freeze payouts, or ban Marketplace access for ToS violations, repeated disputes, or prohibited content.
4. Before publishing or binding listings while Connect is linked, you must **attest** that your listings comply with the prohibited and restricted categories below (and with Stripe’s applicable restricted-business rules).

Official catalog sales remain ReBotics as merchant of record and are not seller Connect checkouts.

## Prohibited and restricted listings

Community listings must not offer goods, services, or content that Stripe or applicable law treat as prohibited or heavily restricted. Without listing Stripe’s full catalog, examples include:

- Gambling, games of chance, and related credit
- Adult sexual content and services
- Weapons, explosives, and illegal goods or substances
- Fraud, malware, credential theft, or other clearly illegal activity

GodMode may refuse, delist, or ban accounts that violate this section. Catalog intake policy CI (when enabled) is an additional gate; sellers remain responsible for compliance.

## Live Share catalog pin

Community **Live Share** listings require a Community catalog entry with `deliveryMode: live` and a successful **bind** of a workspace resource whose export matches the pinned catalog bundle. You must keep that resource aligned with the pin. Local drift or a catalog pin bump demotes the listing until you re-bind (or open a new catalog PR and re-bind). Free Shared sidebar grants stay outside Marketplace.

## Digital goods are final

Marketplace items are software (packs, plugins, and related digital content). Once payment succeeds and the item is delivered or install entitlement is granted, you have usable software. **There are no refunds for delivered Official digital goods.** Delivered Community goods are likewise not refundable by GodMode; ordinary purchase disputes are between buyer and seller (and the payment processor where applicable).

## Community disputes and failed provisioning

For Community purchases, disputes are between the two transacting parties (buyer and seller). GodMode is not the seller and does not mediate ordinary buyer/seller disagreements.

Exception: if payment succeeded but GodMode did not register the transaction to grant access or deliver the purchased software, the buyer should email **support@godmode.software** with details (account email, approximate payment date, item, and any payment reference). We will look into it. That path is for failed access provisioning only and does not create a general refund right, an SLA, or liability for delivered goods.

## Chargebacks and disputes

If you reverse a payment via chargeback, payment dispute, or similar clawback after delivery:

1. Your Marketplace access is **permanently banned**.
2. You may not **buy** or **earn** (sell) on the Marketplace.
3. GodMode Cloud login (SaaS seat) may continue if your subscription is otherwise valid.

This policy exists because software cannot be practically "returned" once installed.

## Payment methods

Buyers may pay with card (Stripe), PayPal, or crypto (MetaMask-compatible) where configured. Sellers must connect at least one payout method before publishing paid listings.

## Acceptance

Using Marketplace buy or sell features requires accepting the current ToS version. Continued use after a ToS version bump requires re-acceptance. Sellers with Stripe Connect linked must also complete the Connect attestation described above when publishing, submitting catalog entries, or binding Live Share.
