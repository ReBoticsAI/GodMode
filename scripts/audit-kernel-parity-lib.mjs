/**
 * Product-parity discovery for kernel migration re-audit.
 * Detects ownership split-brain, silent agent principal fallback, and read/write asymmetry.
 */
import fs from "node:fs";
import path from "node:path";
import {
  slash,
  walkFiles,
  discoverKernelSchema,
  discoverMutationRoutes,
} from "./audit-kernel-lib.mjs";

/** ObjectTypes whose adapters stamp ownership from ctx.agentId (agent-owned knowledge). */
export const AGENT_OWNED_CONTENT_TYPES = new Set([
  "Memory",
  "Rule",
  "Skill",
  "Artifact",
  "ReflectionProposal",
  "PromptFlow",
  "ProviderCredential",
  "Workflow",
]);

export function fileText(repoRoot, relative) {
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute)) return null;
  return fs.readFileSync(absolute, "utf8");
}

export function httpRecordContextSetsAgentId(repoRoot) {
  const text = fileText(repoRoot, "apps/bridge/src/kernel/routes.ts");
  if (!text) return { ok: false, detail: "kernel/routes.ts missing" };
  // Accept arrow-object or block factories, and shared resolveAgentIdFromRequest helpers.
  const contextBlock =
    text.match(
      /const context\s*=\s*\([\s\S]*?\):\s*OperationContext\s*=>\s*\(([\s\S]*?)\);/
    ) ||
    text.match(
      /const context\s*=\s*\([\s\S]*?\):\s*OperationContext\s*=>\s*\{([\s\S]*?)return\s*\{([\s\S]*?)\};/
    );
  const body = contextBlock
    ? `${contextBlock[1] ?? ""}\n${contextBlock[2] ?? ""}`
    : text;
  const setsAgent =
    (/\bagentId\s*:/.test(body) || /agentId,/.test(body)) &&
    (/resolveAgentIdFromRequest/.test(text) ||
      /req\.query\.agentId/.test(body) ||
      /req\.get\(\s*["']X-GodMode-Agent-Id["']/.test(body) ||
      /req\.headers/.test(body) ||
      /X-GodMode-Agent-Id/.test(text));
  return {
    ok: setsAgent,
    detail: setsAgent
      ? "HTTP context sets agentId from request"
      : "HTTP OperationContext omits agentId (silent fallback to intelligence)",
    snippet: body.trim().slice(0, 400),
  };
}

export function productivityAdapterForcesUser(repoRoot) {
  const text = fileText(repoRoot, "apps/bridge/src/kernel/adapters/productivity.ts");
  if (!text) return { ensureUserProject: false, ensureAgentProject: false };
  return {
    ensureUserProject: /ensureUserProject\(/.test(text),
    ensureAgentProject: /ensureAgentProject\(/.test(text),
    importsEnsureAgent: /import\s*\{[^}]*ensureAgentProject/.test(text),
  };
}

export function legacyAiAgentRoutes(repoRoot) {
  const text = fileText(repoRoot, "apps/bridge/src/routes/ai.ts");
  if (!text) return [];
  const routes = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(text))) {
    const method = match[1].toUpperCase();
    const local = match[2];
    if (
      local.includes("project") ||
      local.includes("calendar") ||
      local.includes("memor") ||
      local.includes("rule") ||
      local.includes("skill") ||
      local.includes("artifact") ||
      local.includes("workflow") ||
      local.includes("schedule")
    ) {
      routes.push({
        method,
        path: `/api/ai${local.startsWith("/") ? local : `/${local}`}`,
      });
    }
  }
  return routes;
}

export function discoverAgentScopeUiUsages(repoRoot) {
  const webRoot = path.join(repoRoot, "apps", "web", "src");
  const files = walkFiles(webRoot, new Set([".ts", ".tsx"]));
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const relative = slash(path.relative(repoRoot, file));
    const patterns = [
      {
        kind: "ProjectsBoard",
        re: /<ProjectsBoard[^>]*kind:\s*["']agent["']|<ProjectsBoard[\s\S]{0,120}?kind:\s*["']agent["']/,
      },
      {
        kind: "CalendarBoard",
        re: /<CalendarBoard[^>]*kind:\s*["']agent["']|<CalendarBoard[\s\S]{0,120}?kind:\s*["']agent["']/,
      },
    ];
    for (const { kind, re } of patterns) {
      const match = re.exec(text);
      if (!match) continue;
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      hits.push({ file: relative, line, kind });
    }
  }
  return hits;
}

export function apiHelperDropsAgentId(repoRoot) {
  const text = fileText(repoRoot, "apps/web/src/api.ts");
  if (!text) return [];
  const drops = [];
  const helpers = [
    { name: "createAiMemory", type: "Memory" },
    { name: "createAiArtifact", type: "Artifact" },
    { name: "createCalendarEvent", type: "CalendarEvent" },
    { name: "createProjectCard", type: "TaskCard" },
    { name: "updateAiRuleState", type: "Rule" },
    { name: "updateAiSkillState", type: "Skill" },
  ];
  for (const helper of helpers) {
    const start = text.search(
      new RegExp(`export (?:const|function) ${helper.name}\\b`)
    );
    if (start < 0) continue;
    const slice = text.slice(start, start + 900);
    const acceptsAgentId = /agentId\??:/.test(slice);
    const sendsAgentId =
      /(?<!assigned_|project_)agent_id\s*:/.test(slice) ||
      /\{\s*agentId:\s*(?:body|patch)\.agentId/.test(slice) ||
      /agentId:\s*body\.agentId/.test(slice) ||
      /agentId:\s*patch\.agentId/.test(slice) ||
      /\{\s*agentId\s*\}/.test(slice) ||
      /,\s*\{\s*agentId\s*\}/.test(slice);
    if (acceptsAgentId && !sendsAgentId) {
      drops.push({
        helper: helper.name,
        objectType: helper.type,
        detail: `${helper.name} accepts agentId but does not send agent_id in Record payload`,
      });
    }
  }
  return drops;
}

export function contentAdapterAgentFallback(repoRoot) {
  const text = fileText(repoRoot, "apps/bridge/src/kernel/adapters/content.ts");
  if (!text) return { hasFallback: false };
  const match = text.match(
    /function agentId\(ctx:\s*OperationContext\):\s*string\s*\{([\s\S]*?)\}/
  );
  return {
    hasFallback: Boolean(
      match && /ctx\.agentId\s*\?\?\s*["']intelligence["']/.test(match[0])
    ),
    detail: match ? match[0].trim().slice(0, 200) : "agentId(ctx) helper not found",
  };
}

/**
 * Core product-parity findings (P0 classes). Used by ownership + parity report.
 */
export function discoverOwnershipParityFindings(repoRoot) {
  const findings = [];
  const httpCtx = httpRecordContextSetsAgentId(repoRoot);
  const adapter = productivityAdapterForcesUser(repoRoot);
  const agentUi = discoverAgentScopeUiUsages(repoRoot);
  const drops = apiHelperDropsAgentId(repoRoot);
  const contentFb = contentAdapterAgentFallback(repoRoot);
  const legacy = legacyAiAgentRoutes(repoRoot);
  const hasAiProjects = legacy.some((r) => r.path.includes("/projects"));
  const hasAiCalendar = legacy.some((r) => r.path.includes("/calendar"));

  if (!httpCtx.ok) {
    findings.push({
      id: "P0-ctx-agentId",
      class: "silent_fallback",
      severity: "P0",
      files: ["apps/bridge/src/kernel/routes.ts"],
      summary: httpCtx.detail,
    });
  }

  if (adapter.ensureUserProject && !adapter.ensureAgentProject && agentUi.length) {
    if (hasAiProjects) {
      findings.push({
        id: "P0-tasks-split",
        class: "split_brain",
        severity: "P0",
        files: [
          "apps/bridge/src/kernel/adapters/productivity.ts",
          "apps/bridge/src/routes/ai.ts",
          ...agentUi
            .filter((h) => h.kind === "ProjectsBoard")
            .map((h) => `${h.file}:${h.line}`),
        ],
        summary:
          "Agent Chat Tasks UI lists via GET /ai/projects?agentId= but TaskCard Record mutations force ensureUserProject (user board).",
      });
    }
    if (hasAiCalendar) {
      findings.push({
        id: "P0-cal-split",
        class: "split_brain",
        severity: "P0",
        files: [
          "apps/bridge/src/kernel/adapters/productivity.ts",
          "apps/bridge/src/routes/ai.ts",
          ...agentUi
            .filter((h) => h.kind === "CalendarBoard")
            .map((h) => `${h.file}:${h.line}`),
        ],
        summary:
          "Agent Chat Calendar UI lists via GET /ai/calendar?agentId= but CalendarEvent Record mutations force user_id ownership.",
      });
    }
  }

  if (
    !httpCtx.ok &&
    contentFb.hasFallback &&
    drops.some((d) => AGENT_OWNED_CONTENT_TYPES.has(d.objectType))
  ) {
    findings.push({
      id: "P0-knowledge-fallback",
      class: "silent_fallback",
      severity: "P0",
      files: [
        "apps/bridge/src/kernel/adapters/content.ts",
        "apps/web/src/api.ts",
        "apps/web/src/pages/ai-settings/MemoryTab.tsx",
        "apps/web/src/components/intelligence/IntelligencePanel.tsx",
      ],
      summary:
        "Memory/Artifact/Rule/Skill web creates pass activeAgentId into helpers that strip agent_id; HTTP Record context has no agentId → adapters stamp intelligence.",
    });
  }

  for (const drop of drops) {
    if (drop.objectType === "TaskCard" || drop.objectType === "CalendarEvent") {
      findings.push({
        id: `P1-dropped-${drop.helper}`,
        class: "dropped_client_agentId",
        severity: "P1",
        files: ["apps/web/src/api.ts"],
        summary: drop.detail,
      });
    }
  }

  const ensureText =
    fileText(repoRoot, "apps/bridge/src/services/user-productivity.ts") ?? "";
  if (
    /ensureAgentProject/.test(ensureText) &&
    /todo_write|Kanban/.test(ensureText) &&
    !adapter.ensureAgentProject
  ) {
    findings.push({
      id: "P1-stale-ensureAgentProject",
      class: "stale_comment",
      severity: "P1",
      files: ["apps/bridge/src/services/user-productivity.ts"],
      summary:
        "ensureAgentProject comments still describe agent Kanban / todo_write ownership, but TaskCard adapter only calls ensureUserProject.",
    });
  }

  const features = fileText(repoRoot, "docs/FEATURES.md") ?? "";
  if (
    /Chat → Calendar tab/.test(features) &&
    hasAiCalendar &&
    findings.some((f) => f.id === "P0-cal-split")
  ) {
    findings.push({
      id: "P1-docs-calendar-agent",
      class: "docs_lie",
      severity: "P1",
      files: ["docs/FEATURES.md"],
      summary:
        "FEATURES claims Calendar is available in Chat → Calendar tab (implies agent board), but writes go to personal user calendar via Record API.",
    });
  }
  if (/you and your agents/.test(features) && /Bank/.test(features)) {
    const holdings =
      fileText(repoRoot, "apps/bridge/src/kernel/domains/finance.ts") ?? "";
    if (!/agent_id/.test(holdings)) {
      findings.push({
        id: "P2-bank-claims",
        class: "docs_lie",
        severity: "P2",
        files: ["docs/FEATURES.md", "apps/bridge/src/kernel/domains/finance.ts"],
        summary:
          "FEATURES says Bank connects wallets for you and your agents, but FinanceConnection has no agent_id ownership column.",
      });
    }
  }

  return findings;
}

/**
 * Read vs write path map for key ObjectTypes / UI surfaces.
 */
export function discoverReadWriteSymmetry(repoRoot) {
  const schema = discoverKernelSchema(repoRoot);
  const legacy = legacyAiAgentRoutes(repoRoot);
  const { allRoutes } = discoverMutationRoutes(repoRoot);
  const adapter = productivityAdapterForcesUser(repoRoot);
  const httpCtx = httpRecordContextSetsAgentId(repoRoot);
  const dualTasks = adapter.ensureUserProject && adapter.ensureAgentProject;
  const rows = [];

  const catalog = [
    {
      surface: "TaskCard",
      listAgent: legacy.filter((r) => r.path.includes("/projects")),
      listUser: allRoutes.filter((r) => r.fullPath?.includes("/user/projects")),
      recordOps: schema.get("TaskCard")?.operations ?? new Set(),
      mutatePrincipal: dualTasks
        ? "dual (ensureUserProject | ensureAgentProject via ctx.agentId)"
        : "user (ensureUserProject)",
      listPrincipalAgent: "agentId query",
      listPrincipalUser: "session user",
    },
    {
      surface: "CalendarEvent",
      listAgent: legacy.filter((r) => r.path.includes("/calendar")),
      listUser: allRoutes.filter((r) => r.fullPath?.includes("/user/calendar")),
      recordOps: schema.get("CalendarEvent")?.operations ?? new Set(),
      mutatePrincipal: dualTasks
        ? "dual (user_id | agent_id via ctx.agentId)"
        : "user (user_id)",
      listPrincipalAgent: "agentId query",
      listPrincipalUser: "session user",
    },
    {
      surface: "Memory",
      listAgent: legacy.filter((r) => r.path.includes("/memor")),
      listUser: [],
      recordOps: schema.get("Memory")?.operations ?? new Set(),
      mutatePrincipal: httpCtx.ok
        ? "ctx.agentId (HTTP ?agentId= / header)"
        : "ctx.agentId ?? intelligence",
      listPrincipalAgent: "agentId query",
      listPrincipalUser: null,
    },
    {
      surface: "Rule",
      listAgent: legacy.filter((r) => r.path.includes("/rules")),
      listUser: [],
      recordOps: schema.get("Rule")?.operations ?? new Set(),
      mutatePrincipal: httpCtx.ok
        ? "ctx.agentId (HTTP ?agentId= / header)"
        : "ctx.agentId ?? intelligence",
      listPrincipalAgent: "agentId query",
      listPrincipalUser: null,
    },
    {
      surface: "Skill",
      listAgent: legacy.filter((r) => r.path.includes("/skills")),
      listUser: [],
      recordOps: schema.get("Skill")?.operations ?? new Set(),
      mutatePrincipal: httpCtx.ok
        ? "ctx.agentId (HTTP ?agentId= / header)"
        : "ctx.agentId ?? intelligence",
      listPrincipalAgent: "agentId query",
      listPrincipalUser: null,
    },
    {
      surface: "Artifact",
      listAgent: legacy.filter((r) => r.path.includes("/artifact")),
      listUser: [],
      recordOps: schema.get("Artifact")?.operations ?? new Set(),
      mutatePrincipal: httpCtx.ok
        ? "ctx.agentId (HTTP ?agentId= / header)"
        : "ctx.agentId ?? intelligence",
      listPrincipalAgent: "agentId query",
      listPrincipalUser: null,
    },
    {
      surface: "Workflow",
      listAgent: legacy.filter((r) => r.path.includes("/workflow")),
      listUser: [],
      recordOps: schema.get("Workflow")?.operations ?? new Set(),
      mutatePrincipal: httpCtx.ok
        ? "ctx.agentId (HTTP ?agentId= / header)"
        : "ctx.agentId ?? intelligence",
      listPrincipalAgent: "agentId query",
      listPrincipalUser: null,
    },
  ];

  for (const item of catalog) {
    const asymmetric =
      item.listAgent.length > 0 &&
      item.mutatePrincipal.startsWith("user") &&
      item.listPrincipalAgent === "agentId query";
    const silentAgent =
      item.mutatePrincipal.includes("intelligence") && item.listAgent.length > 0;
    rows.push({
      surface: item.surface,
      listAgentRoutes: item.listAgent.map((r) => `${r.method} ${r.path}`),
      listUserRoutes: item.listUser.map((r) => `${r.method} ${r.fullPath}`),
      recordOperations: [...item.recordOps],
      listPrincipalAgent: item.listPrincipalAgent,
      listPrincipalUser: item.listPrincipalUser,
      mutatePrincipal: item.mutatePrincipal,
      verdict: asymmetric
        ? "split_brain"
        : silentAgent
          ? "silent_fallback_risk"
          : "ok_or_agent_only",
    });
  }

  return rows;
}

/** Full domain matrix rows for the human report. */
export function buildDomainGapMatrix(repoRoot, evidence = {}) {
  const findings = discoverOwnershipParityFindings(repoRoot);
  const symmetry = discoverReadWriteSymmetry(repoRoot);
  const findingBySurface = (surface) =>
    findings.filter(
      (f) =>
        f.summary.toLowerCase().includes(surface.toLowerCase()) ||
        f.id.toLowerCase().includes(surface.toLowerCase().slice(0, 4))
    );

  const domains = [
    {
      domain: "productivity.tasks",
      preMigration: "agent-owned ai_projects.agent_id (+ later user boards)",
      schemaToday:
        "ai_projects.agent_id AND ai_projects.user_id; cards.assigned_agent_id",
      listPath: "agent: GET /ai/projects?agentId=; user: GET /user/projects",
      mutatePath:
        "Record TaskCard → ensureUserProject (personal) | ensureAgentProject (ctx.agentId)",
      toolPath:
        "todo_write / create_project_card → agent board when ctx.agentId set",
      webUi: "/tasks (user); Chat Automations/projects (agent scope)",
      docsClaim: "FEATURES: personal /tasks; Chat still mounts agent ProjectsBoard",
      verdict: findings.some((f) => f.id === "P0-tasks-split")
        ? "split_brain"
        : "parity_ok",
      evidence: evidence.tasks ?? null,
      relatedFindings: findingBySurface("tasks").map((f) => f.id),
    },
    {
      domain: "productivity.calendar",
      preMigration: "agent-owned ai_calendar_events.agent_id",
      schemaToday: "agent_id + user_id columns; dual workspace via ctx.agentId",
      listPath: "agent: GET /ai/calendar/*?agentId=; user: GET /user/calendar/*",
      mutatePath: "Record CalendarEvent → user_id OR agent_id via ctx.agentId",
      toolPath: "agent tools use agent calendar when scoped",
      webUi: "/calendar (user); Chat Calendar tab (agent scope)",
      docsClaim: "FEATURES: personal /calendar + Chat → Calendar tab",
      verdict: findings.some((f) => f.id === "P0-cal-split")
        ? "split_brain"
        : "parity_ok",
      evidence: evidence.calendar ?? null,
      relatedFindings: findingBySurface("calendar").map((f) => f.id),
    },
    {
      domain: "intelligence.memory",
      preMigration: "agent-owned ai_memories.agent_id",
      schemaToday: "agent_id (unchanged)",
      listPath: "GET /ai/memories?agentId=",
      mutatePath: "Record Memory; adapter agentId(ctx) with HTTP ?agentId=",
      toolPath: "ctx.agentId from activeAgentId",
      webUi: "Chat Knowledge → Memory (passes activeAgentId via ?agentId=)",
      docsClaim: "FEATURES: memory attached to active agent",
      verdict: findings.some((f) => f.id === "P0-knowledge-fallback")
        ? "silent_fallback"
        : "parity_ok",
      evidence: evidence.memory ?? null,
      relatedFindings: findingBySurface("memory")
        .concat(findingBySurface("knowledge"))
        .map((f) => f.id),
    },
    {
      domain: "intelligence.rules_skills_artifacts",
      preMigration: "agent-owned / agent-enablement tables",
      schemaToday: "agent_id + ai_agent_*_state",
      listPath: "GET /ai/rules|skills|artifacts?agentId=",
      mutatePath: "Record API; HTTP ctx.agentId from ?agentId=",
      toolPath: "ctx.agentId set",
      webUi: "Chat Knowledge tabs",
      docsClaim: "per active agent",
      verdict: findings.some((f) => f.id === "P0-knowledge-fallback")
        ? "silent_fallback"
        : "parity_ok",
      evidence: evidence.knowledge ?? null,
      relatedFindings: ["P0-knowledge-fallback", "P0-ctx-agentId"].filter((id) =>
        findings.some((f) => f.id === id)
      ),
    },
    {
      domain: "automation.workflows",
      preMigration: "agent-owned ai_workflows.agent_id",
      schemaToday: "agent_id",
      listPath: "GET /ai/workflows?agentId=",
      mutatePath: "Record Workflow; HTTP ctx.agentId when scoped",
      toolPath: "ctx.agentId",
      webUi: "Chat Automations",
      docsClaim: "agent automations",
      verdict: findings.some((f) => f.id === "P0-ctx-agentId")
        ? "silent_fallback_risk"
        : "parity_ok",
      evidence: evidence.workflows ?? null,
      relatedFindings: ["P0-ctx-agentId"].filter((id) =>
        findings.some((f) => f.id === id)
      ),
    },
    {
      domain: "automation.hooks",
      preMigration: "dual owner_kind user|agent",
      schemaToday: "owner_kind + owner_id",
      listPath: "kernel Hook list",
      mutatePath: "Record Hook",
      toolPath: "varies",
      webUi: "Automations (can filter by agent)",
      docsClaim: "hooks for users and agents",
      verdict: "parity_ok",
      evidence: null,
      relatedFindings: [],
    },
    {
      domain: "structure",
      preMigration: "tenant tree; optional agent attachment",
      schemaToday: "structure_nodes.agent_id (nav attach)",
      listPath: "Record StructureNode",
      mutatePath: "Record + set_agent action",
      toolPath: "structure tools",
      webUi: "/structure",
      docsClaim: "workspace structure",
      verdict: "parity_ok",
      evidence: null,
      relatedFindings: [],
    },
    {
      domain: "wiki",
      preMigration: "tenant + author_user_id",
      schemaToday: "same",
      listPath: "Record WikiPage",
      mutatePath: "Record WikiPage",
      toolPath: "wiki tools; may read agent memories as source",
      webUi: "/wiki",
      docsClaim: "tenant wiki",
      verdict: "parity_ok",
      evidence: null,
      relatedFindings: [],
    },
    {
      domain: "messages",
      preMigration: "user conversations; agents as members",
      schemaToday: "user-centric + agent member kinds",
      listPath: "DM APIs / Record",
      mutatePath: "Record / delegated upload",
      toolPath: "n/a",
      webUi: "Chat DMs",
      docsClaim: "DMs with users and agents",
      verdict: "parity_ok",
      evidence: null,
      relatedFindings: [],
    },
    {
      domain: "vault",
      preMigration: "tenant shared secrets",
      schemaToday: "ai_secrets (no agent_id); ProviderCredential agent-owned",
      listPath: "VaultSecret + ProviderCredential",
      mutatePath: "Record",
      toolPath: "credential tools with agentId",
      webUi: "/vault; Agents accounts",
      docsClaim: "Vault shared; agent accounts separate",
      verdict: "parity_ok",
      evidence: null,
      relatedFindings: [],
    },
    {
      domain: "bank",
      preMigration: "tenant holdings (no agent column)",
      schemaToday: "holdings_* tenant; ai_agent_accounts for provider keys",
      listPath: "FinanceConnection / bank routes",
      mutatePath: "Record / platform actions",
      toolPath: "list_holdings tenant-scoped",
      webUi: "/bank; Chat Bank tab",
      docsClaim: "you and your agents",
      verdict: findings.some((f) => f.id === "P2-bank-claims")
        ? "docs_lie"
        : "intentional_personal_os",
      evidence: null,
      relatedFindings: findingBySurface("bank").map((f) => f.id),
    },
    {
      domain: "kernel.http_context",
      preMigration: "n/a (pre-kernel used /ai agentId)",
      schemaToday: "OperationContext.agentId optional",
      listPath: "n/a",
      mutatePath:
        "POST /api/records/* sets ctx.agentId from ?agentId= / X-GodMode-Agent-Id",
      toolPath: "kernelOperationContext sets agentId",
      webUi: "all Record mutations",
      docsClaim: "kernel is the mutation boundary",
      verdict: findings.some((f) => f.id === "P0-ctx-agentId")
        ? "silent_fallback"
        : "parity_ok",
      evidence: evidence.httpContext ?? null,
      relatedFindings: ["P0-ctx-agentId"].filter((id) =>
        findings.some((f) => f.id === id)
      ),
    },
  ];

  return { findings, symmetry, domains, generatedAt: new Date().toISOString() };
}

export function formatParityMarkdown(report) {
  const lines = [];
  lines.push("# Kernel product-parity report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (!report.findings.length) {
    lines.push("_No ownership/parity findings._");
  } else {
    for (const f of report.findings.sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`### ${f.id} (${f.severity})`);
      lines.push("");
      lines.push(`- **Class:** ${f.class}`);
      lines.push(`- **Summary:** ${f.summary}`);
      lines.push(`- **Files:** ${f.files.join(", ")}`);
      lines.push("");
    }
  }
  lines.push("## Domain gap matrix");
  lines.push("");
  lines.push("| Domain | Verdict | Pre-migration | Mutate path | Web UI |");
  lines.push("|---|---|---|---|---|");
  for (const d of report.domains) {
    lines.push(
      `| ${d.domain} | \`${d.verdict}\` | ${d.preMigration.replace(/\|/g, "/")} | ${d.mutatePath.replace(/\|/g, "/")} | ${d.webUi.replace(/\|/g, "/")} |`
    );
  }
  lines.push("");
  lines.push("## Read/write symmetry");
  lines.push("");
  for (const row of report.symmetry) {
    lines.push(
      `- **${row.surface}** — ${row.verdict}; mutate=${row.mutatePrincipal}; agent lists=${row.listAgentRoutes.join(", ") || "none"}`
    );
  }
  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  lines.push(
    'Default: **restore dual model** (personal OS user boards + per-agent Chat workspaces) by wiring HTTP `OperationContext.agentId` and restoring agent TaskCard/CalendarEvent paths for `kind: "agent"` UI. Alternative: collapse Chat tabs onto user boards and update FEATURES.'
  );
  lines.push("");
  return lines.join("\n");
}
