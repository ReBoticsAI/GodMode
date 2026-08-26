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
    id: "authentication-email-verify",
    methods: ["POST"],
    pathPattern: "/api/auth/request-verification",
    rationale: "Email verification request is authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-email-resend-verification",
    methods: ["POST"],
    pathPattern: "/api/auth/resend-verification",
    rationale:
      "Authenticated verification resend is authentication transport (surfaces mail delivery errors).",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-email-verify-consume",
    methods: ["POST"],
    pathPattern: "/api/auth/verify-email",
    rationale: "Email verification token consume is authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-forgot-password",
    methods: ["POST"],
    pathPattern: "/api/auth/forgot-password",
    rationale: "Password reset request is authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-reset-password",
    methods: ["POST"],
    pathPattern: "/api/auth/reset-password",
    rationale: "Password reset token consume is authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-mfa-verify-login",
    methods: ["POST"],
    pathPattern: "/api/auth/mfa/verify-login",
    rationale: "Second-factor login challenge is authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-mfa-begin",
    methods: ["POST"],
    pathPattern: "/api/auth/mfa/begin",
    rationale: "MFA enrollment start is authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-mfa-confirm",
    methods: ["POST"],
    pathPattern: "/api/auth/mfa/confirm",
    rationale: "MFA enrollment confirm is authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-mfa-disable",
    methods: ["POST"],
    pathPattern: "/api/auth/mfa/disable",
    rationale: "MFA disable is authentication transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "authentication-first-workspace",
    methods: ["POST"],
    pathPattern: "/api/auth/tenants",
    rationale:
      "Authenticated first-workspace create for zero-membership users (#369). Kernel Tenant.create sits behind tenantDbMiddleware/resolveTenant and cannot run without an existing membership.",
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
    id: "admin-authority-coding-kills-read",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/coding-kills",
    rationale:
      "Platform-admin read of runtime coding/build kill switches (#96 Slice 1); ops flags in platform_meta, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-coding-status",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/coding-status",
    rationale:
      "Platform-admin coding authority status (#96 Slice 2): kills, limits, live load, supervisor health; not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-coding-events",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/coding-events",
    rationale:
      "Platform-admin cross-tenant coding quota/kill reject feed (#96 Slice 2); tool_audit_log read, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-coding-kills-global",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/coding-kills/global",
    rationale:
      "Platform-admin global coding/build kill switch (#96 Slice 1); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-coding-kills-tenant",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/coding-kills/tenant/:",
    rationale:
      "Platform-admin per-tenant coding/build kill switch (#96 Slice 1); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-spend-kills-read",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/spend-kills",
    rationale:
      "Platform-admin read of runtime spend kill switches (#96 Slice 3); ops flags in platform_meta, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-spend-status",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/spend-status",
    rationale:
      "Platform-admin spend authority status (#96 Slice 3): kills and env nuclear flag; not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-spend-events",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/spend-events",
    rationale:
      "Platform-admin cross-tenant spend kill reject feed (#96 Slice 3); tool_audit_log read, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-spend-kills-global",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/spend-kills/global",
    rationale:
      "Platform-admin global spend kill switch (#96 Slice 3); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-spend-kills-tenant",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/spend-kills/tenant/:",
    rationale:
      "Platform-admin per-tenant spend kill switch (#96 Slice 3); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-deploy-kills-read",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/deploy-kills",
    rationale:
      "Platform-admin read of runtime deploy kill switches (#96 Slice 4); ops flags in platform_meta, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-deploy-status",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/deploy-status",
    rationale:
      "Platform-admin deploy authority status (#96 Slice 4): kills and env nuclear flag; not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-deploy-events",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/deploy-events",
    rationale:
      "Platform-admin cross-tenant deploy kill reject feed (#96 Slice 4); tool_audit_log read, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-deploy-kills-global",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/deploy-kills/global",
    rationale:
      "Platform-admin global deploy kill switch (#96 Slice 4); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-deploy-kills-tenant",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/deploy-kills/tenant/:",
    rationale:
      "Platform-admin per-tenant deploy kill switch (#96 Slice 4); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-delete-kills-read",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/delete-kills",
    rationale:
      "Platform-admin read of runtime delete kill switches (#96 Slice 5); ops flags in platform_meta, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-delete-status",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/delete-status",
    rationale:
      "Platform-admin delete authority status (#96 Slice 5): kills and env nuclear flag; not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-delete-events",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/delete-events",
    rationale:
      "Platform-admin cross-tenant delete kill reject feed (#96 Slice 5); tool_audit_log read, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-delete-kills-global",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/delete-kills/global",
    rationale:
      "Platform-admin global delete kill switch (#96 Slice 5); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-delete-kills-tenant",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/delete-kills/tenant/:",
    rationale:
      "Platform-admin per-tenant delete kill switch (#96 Slice 5); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-send-kills-read",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/send-kills",
    rationale:
      "Platform-admin read of runtime send kill switches (#96 Slice 6); ops flags in platform_meta, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-send-status",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/send-status",
    rationale:
      "Platform-admin send authority status (#96 Slice 6): kills and env nuclear flag; not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-send-events",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/send-events",
    rationale:
      "Platform-admin cross-tenant send kill reject feed (#96 Slice 6); tool_audit_log read, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-send-kills-global",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/send-kills/global",
    rationale:
      "Platform-admin global send kill switch (#96 Slice 6); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-send-kills-tenant",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/send-kills/tenant/:",
    rationale:
      "Platform-admin per-tenant send kill switch (#96 Slice 6); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-audit-events",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/audit-events",
    rationale:
      "Platform-admin unified authority reject feed (#96 Slice 7); merged tool_audit_log read across domains, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-agent-pause-kills-read",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/agent-pause-kills",
    rationale:
      "Platform-admin read of runtime agent pause switches (#96 Slice 8); ops flags in platform_meta, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-agent-pause-status",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/agent-pause-status",
    rationale:
      "Platform-admin agent pause status (#96 Slice 8): kills and per-agent pause flags; not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-agent-pause-events",
    methods: ["GET"],
    pathPattern: "/api/admin/authority/agent-pause-events",
    rationale:
      "Platform-admin cross-tenant agent pause reject feed (#96 Slice 8); tool_audit_log read, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-agent-pause-kills-global",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/agent-pause-kills/global",
    rationale:
      "Platform-admin global agent pause switch (#96 Slice 8); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-agent-pause-kills-tenant",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/agent-pause-kills/tenant/:",
    rationale:
      "Platform-admin per-tenant agent pause switch (#96 Slice 8); platform_meta flags, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-authority-agent-pause-kills-agent",
    methods: ["POST"],
    pathPattern: "/api/admin/authority/agent-pause-kills/tenant/:/agent/:",
    rationale:
      "Platform-admin per-agent pause switch (#96 Slice 8); platform_meta flags, not ObjectType Record CRUD.",
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
    id: "saas-admin-complimentary",
    methods: ["POST"],
    pathPattern: "/api/admin/saas/customers/:/complimentary",
    rationale:
      "Platform-admin grant/revoke complimentary Cloud access via saas_subscriptions; not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-platform-backup",
    methods: ["POST"],
    pathPattern: "/api/admin/marketplace/backup",
    rationale:
      "Platform-admin local SQLite + DuckDB timeseries snapshot trigger; durable meta via platform_backup_meta, not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-marketplace-seller-verified",
    methods: ["POST"],
    pathPattern: "/api/admin/marketplace/sellers/verified",
    rationale:
      "Platform-admin Community verified floor (#311/#313); updates marketplace_seller_accounts.verified_seller, not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-marketplace-seller-frozen",
    methods: ["POST"],
    pathPattern: "/api/admin/marketplace/sellers/frozen",
    rationale:
      "Platform-admin Community verified freeze (#313); updates marketplace_seller_accounts.verified_frozen, not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "tenant-database-download",
    methods: ["GET"],
    pathPattern: "/api/tenant/database/download",
    rationale:
      "Owner-authenticated streaming of a consistent tenant SQLite snapshot for Cloud-to-local continuity (#235); not Record CRUD.",
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
    id: "marketplace-community-catalog-public",
    methods: ["GET"],
    pathPattern: "/api/marketplace/commerce/catalog/community/public",
    rationale:
      "Unauthenticated Community catalog JSON and public listings for local/hub/desktop pulls; not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-seller-storefront-public",
    methods: ["GET"],
    pathPattern: "/api/marketplace/commerce/sellers/:",
    rationale:
      "Unauthenticated seller storefront JSON/HTML for marketing browse and Stripe business_profile crawl (#688); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-seller-storefront-page",
    methods: ["GET"],
    pathPattern: "/api/marketplace/commerce/sellers/:/page",
    rationale:
      "Minimal crawlable HTML for the same public seller payload (#688); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-guest-checkout",
    methods: ["POST"],
    pathPattern: "/api/marketplace/commerce/checkout",
    rationale:
      "Unauthenticated Stripe Checkout for Local buyers; Cloud remains commerce authority. Not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-guest-checkout-status",
    methods: ["GET"],
    pathPattern: "/api/marketplace/commerce/checkout/status",
    rationale:
      "Unauthenticated paid-session lookup for Local delivery; not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-guest-checkout-delivery",
    methods: ["GET"],
    pathPattern: "/api/marketplace/commerce/delivery",
    rationale:
      "Unauthenticated paid delivery payload for Local install after Stripe; not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-device",
    methods: ["POST"],
    pathPattern: "/api/saas/seller-link/device",
    rationale:
      "Unauthenticated device-code start for Local ↔ Cloud Seller link (#680); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-redirect",
    methods: ["GET", "POST"],
    pathPattern: "/api/saas/seller-link/redirect",
    rationale:
      "Browser redirect Seller bind start/status for Local (#706); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-redirect-complete",
    methods: ["POST"],
    pathPattern: "/api/saas/seller-link/redirect/complete",
    rationale:
      "Cloud session completes redirect bind and mints exchange code (#706); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-github-redirect",
    methods: ["GET", "POST"],
    pathPattern: "/api/saas/seller-link/github-redirect",
    rationale:
      "Local Bridge Seller GitHub connect redirect start/status (#711); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-github-redirect-complete",
    methods: ["POST"],
    pathPattern: "/api/saas/seller-link/github-redirect/complete",
    rationale:
      "Cloud Seller finishes GitHub connect and returns to Local (#711); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-github-connect",
    methods: ["POST"],
    pathPattern: "/api/saas/seller-link/github-connect",
    rationale:
      "Cloud Seller starts GitHub OAuth without a workspace (#711 complimentary Seller); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-exchange",
    methods: ["POST"],
    pathPattern: "/api/saas/seller-link/exchange",
    rationale:
      "Local Bridge exchanges one-time seller-link code for gsl_ token (#706); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-token",
    methods: ["POST", "DELETE"],
    pathPattern: "/api/saas/seller-link/token",
    rationale:
      "Device poll and seller-link token revoke for Local Bridge (#680); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-approve",
    methods: ["POST"],
    pathPattern: "/api/saas/seller-link/approve",
    rationale:
      "Cloud user approves Local Seller device-code link (#680); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "saas-seller-link-deny",
    methods: ["POST"],
    pathPattern: "/api/saas/seller-link/deny",
    rationale:
      "Cloud user denies Local Seller device-code link (#680); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-local-cloud-checkout",
    methods: ["POST"],
    pathPattern: "/api/marketplace/cloud-checkout",
    rationale:
      "Authenticated Local Bridge proxy to Cloud guest Stripe Checkout; not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-local-cloud-checkout-complete",
    methods: ["POST"],
    pathPattern: "/api/marketplace/cloud-checkout/complete",
    rationale:
      "Authenticated Local delivery after Cloud paid session; not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-local-seller-link",
    methods: ["GET", "POST", "DELETE"],
    pathPattern: "/api/marketplace/seller-link",
    rationale:
      "Authenticated Local Bridge Seller account link to Cloud (#680); not Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-local-seller-link-start",
    methods: ["POST"],
    pathPattern: "/api/marketplace/seller-link/start",
    rationale: "Start Cloud Seller device-code link from Local (#680).",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-local-seller-link-start-redirect",
    methods: ["POST"],
    pathPattern: "/api/marketplace/seller-link/start-redirect",
    rationale: "Start Cloud Seller browser redirect bind from Local (#706).",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-local-seller-link-github-redirect",
    methods: ["POST"],
    pathPattern: "/api/marketplace/seller-link/github-redirect",
    rationale: "Start Cloud Seller GitHub connect redirect from Local (#711).",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-local-seller-link-exchange",
    methods: ["POST"],
    pathPattern: "/api/marketplace/seller-link/exchange",
    rationale: "Exchange Cloud seller-link code for Local stored token (#706).",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-local-seller-link-poll",
    methods: ["POST"],
    pathPattern: "/api/marketplace/seller-link/poll",
    rationale: "Poll Cloud Seller device-code link from Local (#680).",
    authenticatedDomainMutations: "none",
  },
  {
    id: "marketplace-local-seller-link-status",
    methods: ["GET"],
    pathPattern: "/api/marketplace/seller-link/status",
    rationale: "Local Seller link + Cloud sellerActive status (#680).",
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
    id: "marketplace-admin-official-catalog-sync",
    methods: ["POST"],
    pathPattern: "/api/marketplace/commerce/admin/official-catalog/sync-from-public",
    rationale:
      "SaaS admin import of pinned Official catalog rows from the free public index (#292); not Record CRUD.",
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
    id: "websocket-terminal",
    methods: ["GET"],
    pathPattern: "/ws/terminal",
    rationale:
      "Shared PTY Coding Terminal attach (#162); negotiated over WS, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "websocket-chat",
    methods: ["GET"],
    pathPattern: "/ws/chat",
    rationale:
      "Intelligence Chat turn streaming (#442); negotiated over WS so Cloudflare does not kill long Cursor turns.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-chat-sse",
    methods: ["POST"],
    pathPattern: "/api/ai/chat",
    rationale:
      "SSE adapter over the shared AI chat turn runner; dual-stack with /ws/chat until clients fully migrate. Durable ChatSession/ChatMessage writes stay on createRecord inside the shared runner.",
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
  {
    id: "github-integration-callback",
    methods: ["GET"],
    pathPattern: "/api/integrations/github/callback",
    rationale:
      "GitHub OAuth browser redirect callback (#603); tokens land via GithubIntegration.start_connect state, not Record CRUD JSON.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "user-task-board-create",
    methods: ["POST"],
    pathPattern: "/api/user/projects",
    rationale:
      "Personal kanban board create on ai_projects (multi-board Tasks); board metadata is not TaskCard Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "user-task-board-rename",
    methods: ["PATCH"],
    pathPattern: "/api/user/projects/:",
    rationale: "Personal kanban board rename; board metadata, not TaskCard Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "user-task-board-archive",
    methods: ["POST"],
    pathPattern: "/api/user/projects/:/archive",
    rationale: "Soft-archive personal kanban board; board metadata, not TaskCard Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "user-task-board-columns",
    methods: ["PUT"],
    pathPattern: "/api/user/projects/:/columns",
    rationale:
      "Replace personal kanban columns_json (add/rename/reorder/hide/WIP); board metadata, not TaskCard Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "user-task-board-github-link",
    methods: ["POST"],
    pathPattern: "/api/user/projects/:/github/link",
    rationale:
      "Link a Tasks board to a GitHub Project the user can access; sync config, not TaskCard CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "user-task-board-github-unlink",
    methods: ["POST"],
    pathPattern: "/api/user/projects/:/github/unlink",
    rationale: "Clear GitHub Project link on a Tasks board; sync config, not TaskCard CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "user-task-board-github-sync",
    methods: ["POST"],
    pathPattern: "/api/user/projects/:/github/sync",
    rationale:
      "Pull GitHub Project items into TaskCards via sync service; orchestration transport.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "user-task-board-github-status-map",
    methods: ["POST"],
    pathPattern: "/api/user/projects/:/github/status-map",
    rationale:
      "Persist column↔GitHub Status option map for a linked board; sync config, not TaskCard CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "user-task-card-github-comment",
    methods: ["POST"],
    pathPattern: "/api/user/projects/cards/:/github/comments",
    rationale:
      "Post a GitHub Issue comment for a linked TaskCard via the connected GitHub token; GitHub transport, not local ai_card_comments Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-mcp-workspace-servers",
    methods: ["PUT"],
    pathPattern: "/api/ai/mcp/servers",
    rationale:
      "Tenant MCP server list in ai_settings; workspace setting, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-mcp-workspace-servers-import",
    methods: ["POST"],
    pathPattern: "/api/ai/mcp/servers/import",
    rationale:
      "One-way import of coding-root MCP JSON into tenant ai_settings; does not write .cursor/.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-workspace-knowledge-import",
    methods: ["POST"],
    pathPattern: "/api/ai/workspace-knowledge/import",
    rationale:
      "One-shot bootstrap of coding-root AGENTS.md / .cursor rules and skills into Knowledge; orchestration over Rule/Skill Records, not generic Record CRUD.",
    authenticatedDomainMutations: "none",
  }, 
  {
    id: "ai-coding-workspace-file",
    methods: ["PUT", "POST", "DELETE"],
    pathPattern: "/api/ai/coding/file",
    rationale:
      "Human Coding workspace file CRUD over sandboxed resolveCodingRoot; filesystem domain, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-coding-workspace-mkdir",
    methods: ["POST"],
    pathPattern: "/api/ai/coding/mkdir",
    rationale:
      "Human Coding workspace mkdir under sandboxed coding root; filesystem domain, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-coding-workspace-rename",
    methods: ["POST"],
    pathPattern: "/api/ai/coding/rename",
    rationale:
      "Human Coding workspace rename/move under sandboxed coding root; filesystem domain, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-coding-workspace-terminal-run",
    methods: ["POST"],
    pathPattern: "/api/ai/coding/terminal/run",
    rationale:
      "Human Coding workspace sandboxed command runner (#148); same runTerminal / bwrap boundary as agent run_terminal, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-coding-workspace-terminal-sessions",
    methods: ["POST"],
    pathPattern: "/api/ai/coding/terminal/sessions",
    rationale:
      "Human/agent shared PTY session create (#162); sandboxed node-pty under coding root, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-coding-workspace-terminal-session-write",
    methods: ["POST"],
    pathPattern: "/api/ai/coding/terminal/sessions/:/write",
    rationale:
      "Shared PTY session stdin write (#162); filesystem/shell domain, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-coding-workspace-terminal-session-close",
    methods: ["DELETE"],
    pathPattern: "/api/ai/coding/terminal/sessions/:",
    rationale:
      "Shared PTY session close/kill (#162); filesystem/shell domain, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "ai-cursor-sdk-session-refresh",
    methods: ["POST"],
    pathPattern: "/api/ai/cursor/refresh",
    rationale:
      "Evict cached Cursor SDK Agent handles and re-probe models with the same Vault API key (#525); transport session hygiene, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "release-submissions-refresh",
    methods: ["POST"],
    pathPattern: "/api/release-submissions/:/refresh",
    rationale:
      "Refresh publisher release metrics from GitHub API (#445); not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
] as const;
