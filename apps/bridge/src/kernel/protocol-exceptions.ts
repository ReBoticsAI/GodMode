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
    id: "saas-admin-access",
    methods: ["POST"],
    pathPattern: "/api/admin/saas/customers/:/access",
    rationale:
      "Platform-admin SaaS access enable/disable for subscription ops; not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "admin-platform-backup",
    methods: ["POST"],
    pathPattern: "/api/admin/marketplace/backup",
    rationale:
      "Platform-admin local SQLite snapshot trigger; durable meta via platform_backup_meta, not Record CRUD.",
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
  {
    id: "github-integration-connect",
    methods: ["POST"],
    pathPattern: "/api/integrations/github/connect",
    rationale:
      "GitHub Projects OAuth start; tokens land in Vault after callback, not ObjectType Record CRUD.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "github-integration-disconnect",
    methods: ["POST"],
    pathPattern: "/api/integrations/github/disconnect",
    rationale:
      "Clears Vault-stored GitHub Projects OAuth token; integration transport, not Record CRUD.",
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
] as const;
