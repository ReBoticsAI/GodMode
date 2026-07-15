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
    rationale: "Authenticated external Sierra Chart command transport performs no local durable mutation.",
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
