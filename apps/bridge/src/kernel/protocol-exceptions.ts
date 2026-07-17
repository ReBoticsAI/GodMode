export interface ProtocolException {
  id: string;
  methods: string[];
  pathPattern: string;
  rationale: string;
  authenticatedDomainMutations: "none" | "kernel-delegated";
}

export const PROTOCOL_EXCEPTIONS: readonly ProtocolException[] = [
  {
    id: "health",
    methods: ["GET"],
    pathPattern: "/api/health",
    rationale: "Unauthenticated process and deployment readiness.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "update-readiness",
    methods: ["GET"],
    pathPattern: "/api/update/readiness",
    rationale:
      "Host updater deep-readiness diagnostic authenticated by a dedicated local supervisor token.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-login",
    methods: ["POST"],
    pathPattern: "/api/auth/login",
    rationale: "Credential verification and session-cookie establishment are authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-logout",
    methods: ["POST"],
    pathPattern: "/api/auth/logout",
    rationale: "Session-cookie invalidation is authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-checkout-session",
    methods: ["POST"],
    pathPattern: "/api/saas/checkout",
    rationale:
      "Stripe Checkout Session creation for SaaS paywall; durable entitlement is recorded after verified payment (webhook or session status).",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-billing-portal",
    methods: ["POST"],
    pathPattern: "/api/saas/portal",
    rationale:
      "Stripe Customer Portal session creation for SaaS subscription management; durable subscription state is synced from Stripe webhooks.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-admin-access",
    methods: ["POST"],
    pathPattern: "/api/admin/saas/customers/:/access",
    rationale:
      "Platform-admin SaaS access enable/disable for subscription ops; not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-official-catalog-public",
    methods: ["GET"],
    pathPattern: "/api/marketplace/commerce/catalog/official/public",
    rationale:
      "Unauthenticated Official catalog JSON for local/private-hub pulls; not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-commerce-config",
    methods: ["GET"],
    pathPattern: "/api/marketplace/commerce/commerce/config",
    rationale: "Public Marketplace payment rails and ToS version; read-only.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-paypal-capture",
    methods: ["POST"],
    pathPattern: "/api/marketplace/commerce/paypal/capture",
    rationale:
      "PayPal order capture transport after buyer approval; durable paid state via marketplace services.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-admin-official-catalog",
    methods: ["GET", "POST"],
    pathPattern: "/api/marketplace/commerce/admin/official-catalog",
    rationale:
      "SaaS admin Official catalog upsert/list for ReBotics MoR pricing; not generic Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "analytics-read-query",
    methods: ["POST"],
    pathPattern: "/api/analytics/timeseries/query",
    rationale: "Read-only analytics query uses POST for a structured query body and performs no mutation.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "federation-command-transport",
    methods: ["POST"],
    pathPattern: "/api/federation/sc/:",
    rationale: "Authenticated external charting command transport performs no local durable mutation.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "websocket",
    methods: ["GET"],
    pathPattern: "/ws",
    rationale: "WebSocket negotiation and transport for kernel-authorized work.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "dm-binary-upload",
    methods: ["POST"],
    pathPattern: "/api/dm/uploads",
    rationale: "Multipart and binary transfer cannot be represented as JSON Records.",
    authenticatedDomainMutations: "kernel-delegated",
  },
  {
    id: "dm-binary-download",
    methods: ["GET"],
    pathPattern: "/api/dm/blobs/:",
    rationale: "Authorized binary response streams bytes from the DM blob store.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ephemeral-presence",
    methods: ["POST"],
    pathPattern: "/api/dm/conversations/:/typing",
    rationale: "Ephemeral typing signal with no durable domain mutation.",
    authenticatedDomainMutations: "none",
  },
] as const;
