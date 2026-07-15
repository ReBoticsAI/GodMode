#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routeRoot = path.join(repoRoot, "apps", "bridge", "src", "routes");
const kernelRoutes = path.join(repoRoot, "apps", "bridge", "src", "kernel", "routes.ts");
const toolRegistry = path.join(
  repoRoot,
  "apps",
  "bridge",
  "src",
  "services",
  "ai-tools-registry.ts"
);
const autoTools = path.join(repoRoot, "apps", "bridge", "src", "kernel", "auto-tools.ts");

const routeSources = [
  {
    file: "routes/admin-billing.ts",
    classification: "protocol-exception",
    rationale: "Platform-admin billing configuration and provider connectivity checks are control-plane operations.",
    routes: ["PUT /", "POST /test"],
  },
  {
    file: "routes/admin-users.ts",
    classification: "compatibility-shim",
    target: "User, Tenant, and TenantMembership ObjectTypes",
    routes: [
      "POST /users", "PATCH /users/:userId", "DELETE /users/:userId",
      "POST /users/:userId/tenants", "PATCH /tenants/:tenantId", "DELETE /tenants/:tenantId",
    ],
  },
  {
    file: "routes/ai.ts",
    classification: "compatibility-shim",
    target: "Intelligence, automation, productivity, and CalendarEvent ObjectTypes/actions",
    routes: [
      "POST /embeddings/start", "POST /embeddings/stop", "POST /embeddings/enabled",
      "POST /capabilities/rebuild", "PUT /settings", "PUT /prompt-flow",
      "POST /memories/:id/approve", "POST /memories", "PUT /memories/:id",
      "DELETE /memories/:id", "PUT /rules/:id", "POST /rules/:id/approve",
      "DELETE /rules/:id", "PUT /skills/:id", "POST /skills/:id/approve",
      "DELETE /skills/:id", "POST /artifacts", "DELETE /artifacts/:id",
      "PUT /agents/assignments", "POST /agents", "POST /agents/:id/clone",
      "PUT /agents/:id", "POST /agents/:id/accounts/apikey",
      "DELETE /agents/:id/accounts/:accountId", "DELETE /agents/:id",
      "PATCH /agents/:id/reflection", "POST /agents/:id/reflection/run",
      "POST /reflection/proposals/:id/approve", "POST /reflection/proposals/:id/reject",
      "POST /memory/distill", "POST /memory/wiki-synthesize", "POST /secrets",
      "DELETE /secrets/:id", "POST /cursor/api-key", "DELETE /cursor/api-key",
      "POST /cursor/cli-login-url", "POST /cursor/use-for-intelligence",
      "POST /select-model", "POST /start", "POST /stop", "POST /restart",
      "POST /chats", "DELETE /chats/:id", "POST /chats/:id/share", "POST /chat",
      "POST /chat/confirm-tool", "DELETE /chats/:chatId/messages/:messageId",
      "POST /chats/:chatId/truncate", "POST /lora-adapters", "POST /adapters",
      "PUT /adapters/:id", "DELETE /adapters/:id", "POST /queue",
      "POST /queue/:id/cancel", "POST /workflows", "PUT /workflows/:id",
      "DELETE /workflows/:id", "POST /workflows/:id/comments",
      "POST /workflows/runs/:id/resume", "POST /workflows/runs/:id/cancel",
      "POST /autonomous/kick", "POST /schedules", "PUT /schedules/:id",
      "DELETE /schedules/:id", "POST /projects/cards", "PATCH /projects/cards/:id",
      "DELETE /projects/cards/:id", "POST /projects/cards/:id/comments",
      "POST /training/jobs", "POST /training/jobs/:id/cancel", "POST /datasets",
      "POST /datasets/build", "POST /calendar/events", "PATCH /calendar/events/:id",
      "DELETE /calendar/events/:id",
    ],
  },
  {
    file: "routes/api-core.ts",
    classification: "compatibility-shim",
    target: "StructureNode Record API and StructureNode actions",
    routes: [
      "PUT /structure/graph/layout", "POST /departments", "PUT /departments/:id",
      "DELETE /departments/:id", "POST /departments/:dept/divisions",
      "PUT /divisions/:dept/:id", "DELETE /divisions/:dept/:id",
      "POST /divisions/:dept/:div/pages", "PUT /pages/:dept/:div/:id",
      "DELETE /pages/:dept/:div/:id", "POST /nodes", "PUT /nodes/:id",
      "DELETE /nodes/:id", "POST /nodes/:id/agent", "DELETE /nodes/:id/agent",
      "POST /structure/reorder",
    ],
  },
  {
    file: "routes/api-core.ts",
    classification: "protocol-exception",
    rationale: "Read-only analytical SQL uses POST so a structured query can be carried in the request body.",
    routes: ["POST /analytics/timeseries/query"],
  },
  {
    file: "routes/auth.ts",
    classification: "protocol-exception",
    rationale: "Authentication, session, credential, profile, and tenant bootstrap operations are identity protocol endpoints.",
    routes: [
      "POST /tenants", "POST /login", "POST /signup", "POST /logout",
      "POST /change-password", "PATCH /profile",
    ],
  },
  {
    file: "routes/connections.ts",
    classification: "compatibility-shim",
    target: "BridgeConnection and PeerConnection ObjectTypes plus federation execute action",
    routes: [
      "POST /", "DELETE /:id", "POST /local", "POST /remote",
      "POST /federation/execute",
    ],
  },
  {
    file: "routes/dm.ts",
    classification: "compatibility-shim",
    target: "DirectConversation and DirectMessage ObjectTypes/actions",
    routes: [
      "POST /conversations", "POST /conversations/:id/messages",
      "POST /conversations/:id/read", "POST /conversations/:id/members",
      "DELETE /conversations/:id/members/:userId", "POST /conversations/:id/share",
      "POST /conversations/:id/typing", "POST /uploads",
    ],
  },
  {
    file: "routes/federation.ts",
    classification: "protocol-exception",
    rationale: "Federation invitation acceptance and signed remote-command dispatch are wire-protocol operations.",
    routes: ["POST /invites/:token/accept", "POST /sc/:verb"],
  },
  {
    file: "routes/financial.ts",
    classification: "compatibility-shim",
    target: "Holding connection ObjectTypes and refresh/connect actions",
    routes: [
      "POST /config/moralis", "POST /config/paypal", "POST /connections",
      "DELETE /connections/:id", "POST /connections/:id/refresh",
      "POST /crypto/balance", "POST /crypto/connect", "POST /paypal/connect",
    ],
  },
  {
    file: "routes/hooks.ts",
    classification: "compatibility-shim",
    target: "Hook, HookRun, and PlatformEvent ObjectTypes/actions",
    routes: [
      "POST /", "PATCH /:id", "DELETE /:id", "POST /runs/:runId/approve",
      "POST /runs/:runId/reject", "POST /",
    ],
  },
  {
    file: "routes/inference.ts",
    classification: "protocol-exception",
    rationale: "Inference endpoint provisioning and model execution are compute protocol commands.",
    routes: ["POST /endpoints", "POST /run"],
  },
  {
    file: "routes/integrations.ts",
    classification: "protocol-exception",
    rationale: "Calendar and email synchronization trigger external integration protocols.",
    routes: ["POST /calendar/sync", "POST /email/sync"],
  },
  {
    file: "routes/marketplace-catalog.ts",
    classification: "compatibility-shim",
    target: "CatalogSource and CatalogInstall ObjectTypes plus plugin lifecycle actions",
    routes: [
      "POST /sources", "DELETE /sources/:id", "POST /local-plugins",
      "DELETE /local-plugins", "POST /plugins/install", "POST /plugins/uninstall",
      "POST /install/:entryId",
    ],
  },
  {
    file: "routes/marketplace.ts",
    classification: "compatibility-shim",
    target: "MarketplaceListing, MarketplaceEntitlement, and InferenceEndpoint ObjectTypes/actions",
    routes: [
      "POST /entitlements/:id/cancel", "POST /wallet/purchase", "POST /wallet/checkout",
      "POST /inference/endpoints", "POST /listings", "POST /listings/:id/acquire",
      "POST /import", "POST /export",
    ],
  },
  {
    file: "routes/network.ts",
    classification: "protocol-exception",
    rationale: "Tailscale and peer invitation endpoints orchestrate networking and federation protocols.",
    routes: [
      "POST /tailscale/enable", "POST /peers/invite", "POST /peers/refresh",
      "POST /share-invites", "POST /share-invites/accept",
    ],
  },
  {
    file: "routes/notifications.ts",
    classification: "compatibility-shim",
    target: "Notification ObjectType actions mark-read, clear, and delete",
    routes: ["POST /read", "POST /clear", "DELETE /:id"],
  },
  {
    file: "routes/onboarding.ts",
    classification: "protocol-exception",
    rationale: "First-run LLM setup and onboarding completion are installation lifecycle commands.",
    routes: ["POST /llm/local", "POST /llm/cloud-ready", "POST /complete"],
  },
  {
    file: "routes/plugins.ts",
    classification: "protocol-exception",
    rationale: "Plugin install and uninstall mutate executable extension lifecycle state, not tenant records.",
    routes: ["POST /install", "POST /uninstall"],
  },
  {
    file: "routes/shares.ts",
    classification: "compatibility-shim",
    target: "ShareGrant ObjectType plus share, clone, and live-resource actions",
    routes: [
      "POST /", "POST /model", "DELETE /:id", "POST /live/:kind/:resourceId/mutate",
      "POST /clone/:kind/:resourceId",
    ],
  },
  {
    file: "routes/support.ts",
    classification: "compatibility-shim",
    target: "SupportTicket and SupportMessage ObjectTypes/actions",
    routes: [
      "POST /tickets", "POST /tickets/:id/messages", "PATCH /tickets/:id",
      "POST /group/members", "DELETE /group/members", "PATCH /admin/tickets/:id",
    ],
  },
  {
    file: "routes/user-productivity.ts",
    classification: "compatibility-shim",
    target: "CalendarEvent, TaskCard, and CardComment ObjectTypes",
    routes: [
      "POST /calendar/events", "PATCH /calendar/events/:id",
      "DELETE /calendar/events/:id", "POST /projects/cards",
      "PATCH /projects/cards/:id", "DELETE /projects/cards/:id",
      "POST /projects/cards/:id/comments",
    ],
  },
  {
    file: "routes/wiki.ts",
    classification: "compatibility-shim",
    target: "WikiPage and WikiProposal ObjectTypes/actions",
    routes: [
      "POST /proposals/:id/approve", "POST /proposals/:id/reject", "POST /pages",
      "PATCH /pages/:id", "DELETE /pages/:id",
    ],
  },
  {
    file: "kernel/routes.ts",
    classification: "kernel-record",
    target: "Dynamic ObjectType create/update/delete Record operations",
    routes: [
      "POST /records/:objectType", "PUT /records/:objectType/:id",
      "DELETE /records/:objectType/:id",
    ],
  },
  {
    file: "kernel/routes.ts",
    classification: "kernel-action",
    target: "Dynamic ObjectType declared action",
    routes: [
      "POST /records/:objectType/actions/:action",
      "POST /records/:objectType/:id/actions/:action",
    ],
  },
];

const TOOL_GROUPS = {
  "kernel-generic": [
    "list_object_types", "list_records", "get_record", "create_record",
    "update_record", "delete_record", "run_record_action",
  ],
  "agent-foundation": [
    "remember", "use_skill", "delegate_to_subagent", "list_subagents", "todo_write",
    "ask_cursor_agent", "create_skill", "create_rule",
  ],
  "web-and-artifacts": [
    "web_search", "fetch_url", "save_artifact", "read_artifact", "list_artifacts",
    "delete_artifact",
  ],
  "tasks-and-personal": [
    "create_project_card", "move_project_card", "list_project_cards", "set_card_priority",
    "create_subtask", "list_subtasks", "add_card_comment", "comment_card",
    "list_card_comments", "list_user_calendar", "create_user_calendar_event",
    "list_user_tasks", "create_user_task", "update_card",
  ],
  "structure-and-agents": [
    "list_structure", "create_department", "create_division", "create_page",
    "update_structure_node", "delete_structure_node", "assign_agent", "set_agent_role",
    "create_agent", "attach_node_agent",
  ],
  "sharing-and-automation": [
    "list_share_grants", "create_share_grant", "share_model", "revoke_share_grant",
    "list_workflows", "run_workflow", "create_workflow", "update_workflow",
    "list_schedules", "create_schedule",
  ],
  coding: [
    "read_file", "list_dir", "glob", "grep", "write_file", "edit_file", "delete_file",
    "run_terminal", "codebase_search", "apply_patch", "read_diagnostics", "revert_file",
    "explore_codebase",
  ],
  "notifications-support-knowledge": [
    "list_notifications", "create_notification", "mark_notification_read",
    "create_support_ticket", "list_support_tickets", "reply_support_ticket",
    "update_support_ticket", "list_wiki_pages", "read_wiki_page", "create_wiki_page",
    "update_wiki_page", "delete_wiki_page",
  ],
  "messages-and-events": [
    "list_conversations", "read_conversation", "send_message", "create_conversation",
    "list_hooks", "create_hook", "update_hook", "delete_hook", "list_hook_runs",
    "emit_event", "list_events",
  ],
  "finance-marketplace-plugins": [
    "list_holdings", "get_net_worth", "create_holding", "refresh_holdings",
    "search_marketplace", "list_my_listings", "create_listing", "install_catalog_entry",
    "list_available_plugins", "scaffold_plugin", "install_plugin", "build_plugin",
    "prepare_marketplace_submission",
  ],
  inference: [
    "get_llm_status", "list_models", "scan_models", "start_llm", "stop_llm",
    "restart_llm", "list_inference_endpoints",
  ],
};

function key(file, methodAndPath, occurrence = 1) {
  return `${file}|${methodAndPath}|#${occurrence}`;
}

function buildRouteBaseline() {
  const entries = [];
  const occurrences = new Map();
  for (const source of routeSources) {
    for (const route of source.routes) {
      const base = `${source.file}|${route}`;
      const occurrence = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occurrence);
      entries.push({
        key: key(source.file, route, occurrence),
        file: source.file,
        route,
        classification: source.classification,
        ...(source.target ? { target: source.target } : {}),
        ...(source.rationale ? { rationale: source.rationale } : {}),
      });
    }
  }
  return entries;
}

function discoverRoutes() {
  const files = fs.readdirSync(routeRoot)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => [path.join(routeRoot, name), `routes/${name}`]);
  files.push([kernelRoutes, "kernel/routes.ts"]);

  const found = [];
  for (const [absolute, relative] of files) {
    const source = fs.readFileSync(absolute, "utf8");
    const routerNames = [
      ...new Set(
        [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Router|express)\s*\(/g)]
          .map((match) => match[1])
      ),
    ];
    if (!routerNames.length) continue;
    const names = routerNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const literalPattern = new RegExp(
      `\\b(?:${names})\\s*\\.\\s*(post|put|patch|delete)\\s*\\(\\s*([\"'\`])([^\"'\`]+)\\2`,
      "g"
    );
    const declarationPattern = new RegExp(
      `\\b(?:${names})\\s*\\.\\s*(post|put|patch|delete)\\s*\\(`,
      "g"
    );
    const declarationCount = [...source.matchAll(declarationPattern)].length;
    const literals = [...source.matchAll(literalPattern)];
    if (declarationCount !== literals.length) {
      throw new Error(
        `${relative}: found ${declarationCount} mutation declarations but only ` +
          `${literals.length} static string paths; classify dynamic declarations explicitly`
      );
    }
    const occurrences = new Map();
    for (const match of literals) {
      const route = `${match[1].toUpperCase()} ${match[3]}`;
      const occurrence = (occurrences.get(route) ?? 0) + 1;
      occurrences.set(route, occurrence);
      found.push(key(relative, route, occurrence));
    }
  }
  return found;
}

function discoverStaticToolNames() {
  const source = fs.readFileSync(toolRegistry, "utf8");
  const start = source.indexOf("export const AI_TOOL_REGISTRY");
  const end = source.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("Could not locate AI_TOOL_REGISTRY");
  const registry = source.slice(start, end);
  return [...registry.matchAll(/\bname:\s*(["'])([^"']+)\1/g)].map((match) => match[2]);
}

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => seen.has(value) || !seen.add(value)))];
}

const errors = [];
const baseline = buildRouteBaseline();
const baselineKeys = baseline.map((entry) => entry.key);
const duplicateRoutes = duplicates(baselineKeys);
if (duplicateRoutes.length) errors.push(`Duplicate route baseline entries: ${duplicateRoutes.join(", ")}`);

let discoveredRoutes = [];
try {
  discoveredRoutes = discoverRoutes();
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

const baselineSet = new Set(baselineKeys);
const discoveredSet = new Set(discoveredRoutes);
const addedRoutes = discoveredRoutes.filter((route) => !baselineSet.has(route));
const removedRoutes = baselineKeys.filter((route) => !discoveredSet.has(route));
if (addedRoutes.length) errors.push(`Unclassified mutation routes:\n  ${addedRoutes.join("\n  ")}`);
if (removedRoutes.length) errors.push(`Removed/renamed baseline routes:\n  ${removedRoutes.join("\n  ")}`);

for (const entry of baseline) {
  if (!["kernel-record", "kernel-action", "compatibility-shim", "protocol-exception"].includes(entry.classification)) {
    errors.push(`Invalid classification for ${entry.key}`);
  }
  if (!entry.target && !entry.rationale) errors.push(`Missing target/rationale for ${entry.key}`);
}

const groupedToolNames = Object.values(TOOL_GROUPS).flat();
const duplicateTools = duplicates(groupedToolNames);
if (duplicateTools.length) errors.push(`Tools assigned to multiple groups: ${duplicateTools.join(", ")}`);

let staticTools = [];
try {
  staticTools = discoverStaticToolNames();
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}
const staticToolSet = new Set(staticTools);
const groupedToolSet = new Set(groupedToolNames);
const ungroupedTools = staticTools.filter((name) => !groupedToolSet.has(name));
const missingTools = groupedToolNames.filter(
  (name) => !staticToolSet.has(name) && !TOOL_GROUPS["kernel-generic"].includes(name)
);
if (ungroupedTools.length) errors.push(`Ungrouped static AI tools: ${ungroupedTools.join(", ")}`);
if (missingTools.length) errors.push(`Removed/renamed grouped AI tools: ${missingTools.join(", ")}`);

const autoSource = fs.readFileSync(autoTools, "utf8");
const discoveredKernelGeneric = [...autoSource.matchAll(/\bname:\s*(["'])([^"']+)\1/g)]
  .map((match) => match[2]);
const expectedKernelGeneric = TOOL_GROUPS["kernel-generic"];
if (
  discoveredKernelGeneric.length !== expectedKernelGeneric.length ||
  discoveredKernelGeneric.some((name) => !expectedKernelGeneric.includes(name))
) {
  errors.push(
    `Kernel generic tool baseline changed: discovered [${discoveredKernelGeneric.join(", ")}]`
  );
}
for (const marker of ["...genericObjectTypeToolDefs()", "objectTypeAutoToolDefs(coreNames)"]) {
  const source = marker.startsWith("...") ? fs.readFileSync(toolRegistry, "utf8") : fs.readFileSync(toolRegistry, "utf8");
  if (!source.includes(marker)) errors.push(`Missing kernel/generated tool registration marker: ${marker}`);
}

if (errors.length) {
  console.error("Kernel migration coverage audit FAILED\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const counts = baseline.reduce((acc, entry) => {
    acc[entry.classification] = (acc[entry.classification] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Kernel migration coverage audit passed: ${baseline.length} mutation routes ` +
      `(${Object.entries(counts).map(([name, count]) => `${name}=${count}`).join(", ")}); ` +
      `${staticTools.length} static AI tools in ${Object.keys(TOOL_GROUPS).length - 1} non-kernel groups; ` +
      `${expectedKernelGeneric.length} kernel generic tools plus generated ObjectType tools.`
  );
}
