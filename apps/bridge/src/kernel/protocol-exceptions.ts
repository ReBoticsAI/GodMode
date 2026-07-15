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
    id: "authentication",
    methods: ["POST", "GET"],
    pathPattern: "/api/auth/*",
    rationale: "Session cookies, signup/login bootstrap, and OAuth callbacks.",
    authenticatedDomainMutations: "kernel-delegated",
  },
  {
    id: "websocket",
    methods: ["GET"],
    pathPattern: "/ws",
    rationale: "WebSocket negotiation and transport for kernel-authorized work.",
    authenticatedDomainMutations: "none",
  },
  {
    id: "streams",
    methods: ["GET", "POST"],
    pathPattern: "/api/*/stream",
    rationale: "Streaming transport for an authorized OperationRun.",
    authenticatedDomainMutations: "kernel-delegated",
  },
  {
    id: "binary-transfer",
    methods: ["GET", "POST"],
    pathPattern: "/api/*/(upload|download)",
    rationale: "Multipart and binary transfer cannot be represented as JSON Records.",
    authenticatedDomainMutations: "kernel-delegated",
  },
  {
    id: "ephemeral-presence",
    methods: ["POST"],
    pathPattern: "/api/dm/*/typing",
    rationale: "Ephemeral typing signal with no durable domain mutation.",
    authenticatedDomainMutations: "none",
  },
] as const;
