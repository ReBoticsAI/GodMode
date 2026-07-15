import path from "node:path";
import fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { agentArtifactsDir, config } from "../config.js";
import type { MarketplaceListingKind } from "../core-db.js";
import { readStructure, structureNodesToLegacy } from "./structure.js";
import { getAgent } from "./agents/agents-db.js";
import {
  createSystemOperationContext,
  seedRecords,
} from "../kernel/record-api.js";

export type PortableKind = MarketplaceListingKind | "record";

export interface PortableBundle {
  version: 1;
  kind: PortableKind;
  exportedAt: string;
  sourceId: string;
  title: string;
  data: Record<string, unknown>;
}

export function exportEntity(
  db: AppDatabase,
  kind: PortableKind,
  id: string
): PortableBundle {
  switch (kind) {
    case "agent":
      return exportAgent(db, id);
    case "department":
      return exportDepartment(db, id);
    case "division":
      return exportDivision(db, id);
    case "page":
      return exportPage(db, id);
    case "workflow":
      return exportWorkflow(db, id);
    case "skill":
      return exportSkill(db, id);
    case "rule":
      return exportRule(db, id);
    case "artifact":
      return exportArtifact(db, id);
    case "adapter":
      return exportAdapter(db, id);
    case "dataset":
      return exportDataset(db, id);
    case "knowledge":
      return exportKnowledge(db, id);
    case "promptflow":
      return exportPromptflow(db, id);
    case "bundle":
      return exportBundle(db, id);
    case "connector_package":
      return exportConnectorPackage(db, id);
    default:
      throw new Error(`Unsupported export kind: ${kind}`);
  }
}

export function importEntity(
  db: AppDatabase,
  bundle: PortableBundle
): { kind: PortableKind; newId: string } {
  if (bundle.version !== 1) throw new Error("Unsupported bundle version");
  switch (bundle.kind) {
    case "agent":
      return { kind: "agent", newId: importAgent(db, bundle) };
    case "department":
      return { kind: "department", newId: importDepartment(db, bundle) };
    case "division":
      return { kind: "division", newId: importDivision(db, bundle) };
    case "page":
      return { kind: "page", newId: importPage(db, bundle) };
    case "workflow":
      return { kind: "workflow", newId: importWorkflow(db, bundle) };
    case "skill":
      return { kind: "skill", newId: importSkill(db, bundle) };
    case "rule":
      return { kind: "rule", newId: importRule(db, bundle) };
    case "artifact":
      return { kind: "artifact", newId: importArtifact(db, bundle) };
    case "adapter":
      return { kind: "adapter", newId: importAdapter(db, bundle) };
    case "dataset":
      return { kind: "dataset", newId: importDataset(db, bundle) };
    case "knowledge":
      return { kind: "knowledge", newId: importKnowledge(db, bundle) };
    case "promptflow":
      return { kind: "promptflow", newId: importPromptflow(db, bundle) };
    case "bundle":
      return { kind: "bundle", newId: importBundle(db, bundle) };
    case "connector_package":
      return { kind: "connector_package", newId: importConnectorPackage(db, bundle) };
    case "record":
      return { kind: "record", newId: importRecord(db, bundle) };
    default:
      throw new Error(`Unsupported import kind: ${bundle.kind}`);
  }
}

const PORTABLE_RECORD_OBJECT_TYPES = new Set([
  "StructureNode",
  "Agent",
  "Skill",
]);

function importRecord(db: AppDatabase, bundle: PortableBundle): string {
  const record = (bundle.data as { record?: unknown }).record;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Portable Record requires data.record");
  }
  const candidate = record as {
    id?: unknown;
    objectType?: unknown;
    data?: unknown;
  };
  if (
    typeof candidate.id !== "string" ||
    !candidate.id.trim() ||
    typeof candidate.objectType !== "string" ||
    !PORTABLE_RECORD_OBJECT_TYPES.has(candidate.objectType) ||
    !candidate.data ||
    typeof candidate.data !== "object" ||
    Array.isArray(candidate.data)
  ) {
    throw new Error("Invalid or unsupported portable Record");
  }
  const data = candidate.data as Record<string, unknown>;
  if (data.id !== candidate.id) {
    throw new Error("Portable Record id must match data.id");
  }
  const agentId =
    typeof data.agent_id === "string" && data.agent_id.trim()
      ? data.agent_id
      : "system";
  const [imported] = seedRecords(
    db,
    [{ objectType: candidate.objectType, data }],
    createSystemOperationContext({ agentId })
  );
  if (!imported) throw new Error("Portable Record import produced no Record");
  return imported.id;
}

function exportAgent(db: AppDatabase, id: string): PortableBundle {
  const agent = getAgent(db, id);
  if (!agent) throw new Error("Agent not found");
  const memories = db
    .prepare(`SELECT * FROM ai_memories WHERE agent_id=?`)
    .all(id);
  const ruleState = db
    .prepare(`SELECT * FROM ai_agent_rule_state WHERE agent_id=?`)
    .all(id);
  const skillState = db
    .prepare(`SELECT * FROM ai_agent_skill_state WHERE agent_id=?`)
    .all(id);
  const artifacts = db
    .prepare(`SELECT * FROM ai_artifacts WHERE agent_id=?`)
    .all(id);
  const workflows = db
    .prepare(`SELECT * FROM ai_workflows WHERE agent_id=?`)
    .all(id);
  return {
    version: 1,
    kind: "agent",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: agent.name,
    data: { agent, memories, ruleState, skillState, artifacts, workflows },
  };
}

function importAgent(db: AppDatabase, bundle: PortableBundle): string {
  const data = bundle.data as {
    agent: Record<string, unknown>;
    memories?: Array<Record<string, unknown>>;
    ruleState?: Array<Record<string, unknown>>;
    skillState?: Array<Record<string, unknown>>;
    artifacts?: Array<Record<string, unknown>>;
    workflows?: Array<Record<string, unknown>>;
  };
  const newId = `${String(data.agent.id ?? "agent")}-import-${uuidv4().slice(0, 8)}`;
  const a = data.agent;
  db.prepare(
    `INSERT INTO ai_agents (
      id, name, description, icon, backend, enabled, is_template,
      system_prompt, sampling_json, thinking_json, tool_allow_json,
      auto_approve_json, model_path, adapter_ids_json, config_json, parent_id, team
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId,
    a.name,
    a.description ?? null,
    a.icon ?? "bot",
    a.backend ?? "local",
    a.enabled ? 1 : 0,
    0,
    a.systemPrompt ?? a.system_prompt ?? "",
    JSON.stringify(a.sampling ?? {}),
    JSON.stringify(a.thinking ?? {}),
    a.toolAllow != null ? JSON.stringify(a.toolAllow) : null,
    JSON.stringify(a.autoApprove ?? []),
    a.modelPath ?? null,
    JSON.stringify(a.adapterIds ?? []),
    JSON.stringify(a.config ?? {}),
    null,
    a.team ?? null
  );
  for (const m of data.memories ?? []) {
    db.prepare(
      `INSERT INTO ai_memories (id, agent_id, scope, text, category, source, enabled, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      newId,
      m.scope ?? "global",
      m.text,
      m.category ?? null,
      m.source ?? "import",
      m.enabled ?? 1,
      m.status ?? "active"
    );
  }
  for (const w of data.workflows ?? []) {
    db.prepare(
      `INSERT INTO ai_workflows (id, name, config_json, enabled, agent_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      `${w.id}-import-${uuidv4().slice(0, 6)}`,
      w.name,
      w.config_json,
      w.enabled ?? 1,
      newId
    );
  }
  return newId;
}

function exportDepartment(db: AppDatabase, id: string): PortableBundle {
  const tree = readStructure(db);
  const { departments } = structureNodesToLegacy(tree);
  const dept = departments.find((d) => d.id === id);
  if (!dept) throw new Error("Department not found");
  return {
    version: 1,
    kind: "department",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: dept.label,
    data: { department: dept },
  };
}

function importDepartment(db: AppDatabase, bundle: PortableBundle): string {
  const dept = (bundle.data as { department: Record<string, unknown> }).department;
  const newId = `${dept.id}-import-${uuidv4().slice(0, 6)}`;
  db.prepare(
    `INSERT INTO departments (id, label, icon, base_path, built_in, sort_order)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(
    newId,
    dept.label,
    dept.icon,
    `/${newId}`,
    dept.sortOrder ?? 99
  );
  const divisions = (dept.divisions as Array<Record<string, unknown>>) ?? [];
  for (const div of divisions) {
    const divId = String(div.id);
    db.prepare(
      `INSERT INTO divisions (id, department_id, label, icon, base_path, right_sidebar, built_in, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      divId,
      newId,
      div.label,
      div.icon,
      `/${newId}/${divId}`,
      div.rightSidebar ?? null,
      div.sortOrder ?? 0
    );
    for (const page of (div.pages as Array<Record<string, unknown>>) ?? []) {
      db.prepare(
        `INSERT INTO division_pages
           (id, division_id, department_id, label, icon, segment, page_kind, built_in, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(
        page.id,
        divId,
        newId,
        page.label,
        page.icon,
        page.segment ?? "",
        page.pageKind ?? "placeholder",
        page.sortOrder ?? 0
      );
    }
  }
  return newId;
}

function exportDivision(db: AppDatabase, compositeId: string): PortableBundle {
  const [departmentId, divisionId] = compositeId.split("/");
  if (!departmentId || !divisionId) throw new Error("Division id must be departmentId/divisionId");
  const row = db
    .prepare(`SELECT * FROM divisions WHERE department_id=? AND id=?`)
    .get(departmentId, divisionId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Division not found");
  const pages = db
    .prepare(
      `SELECT * FROM division_pages WHERE department_id=? AND division_id=?`
    )
    .all(departmentId, divisionId);
  return {
    version: 1,
    kind: "division",
    exportedAt: new Date().toISOString(),
    sourceId: compositeId,
    title: String(row.label),
    data: { division: row, pages },
  };
}

function importDivision(db: AppDatabase, bundle: PortableBundle): string {
  const { division, pages } = bundle.data as {
    division: Record<string, unknown>;
    pages: Array<Record<string, unknown>>;
  };
  const deptId = String(division.department_id);
  const divId = `${division.id}-import-${uuidv4().slice(0, 6)}`;
  db.prepare(
    `INSERT INTO divisions (id, department_id, label, icon, base_path, right_sidebar, built_in, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    divId,
    deptId,
    division.label,
    division.icon,
    `/${deptId}/${divId}`,
    division.right_sidebar ?? null,
    division.sort_order ?? 99
  );
  for (const page of pages ?? []) {
    db.prepare(
      `INSERT INTO division_pages
         (id, division_id, department_id, label, icon, segment, page_kind, built_in, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      page.id,
      divId,
      deptId,
      page.label,
      page.icon,
      page.segment ?? "",
      page.page_kind ?? "placeholder",
      page.sort_order ?? 0
    );
  }
  return `${deptId}/${divId}`;
}

function exportPage(
  db: AppDatabase,
  compositeId: string
): PortableBundle {
  const [departmentId, divisionId, pageId] = compositeId.split("/");
  const row = db
    .prepare(
      `SELECT * FROM division_pages WHERE department_id=? AND division_id=? AND id=?`
    )
    .get(departmentId, divisionId, pageId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Page not found");
  return {
    version: 1,
    kind: "page",
    exportedAt: new Date().toISOString(),
    sourceId: compositeId,
    title: String(row.label),
    data: { page: row },
  };
}

function importPage(db: AppDatabase, bundle: PortableBundle): string {
  const page = (bundle.data as { page: Record<string, unknown> }).page;
  const newPageId = `${page.id}-import-${uuidv4().slice(0, 6)}`;
  db.prepare(
    `INSERT INTO division_pages
       (id, division_id, department_id, label, icon, segment, page_kind, built_in, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    newPageId,
    page.division_id,
    page.department_id,
    page.label,
    page.icon,
    page.segment ?? "",
    page.page_kind ?? "placeholder",
    page.sort_order ?? 0
  );
  return `${page.department_id}/${page.division_id}/${newPageId}`;
}

function exportWorkflow(db: AppDatabase, id: string): PortableBundle {
  const row = db.prepare(`SELECT * FROM ai_workflows WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("Workflow not found");
  return {
    version: 1,
    kind: "workflow",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: String(row.name),
    data: { workflow: row },
  };
}

function importWorkflow(db: AppDatabase, bundle: PortableBundle): string {
  const w = (bundle.data as { workflow: Record<string, unknown> }).workflow;
  const newId = `${w.id}-import-${uuidv4().slice(0, 6)}`;
  db.prepare(
    `INSERT INTO ai_workflows (id, name, config_json, enabled, agent_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    newId,
    w.name,
    w.config_json,
    w.enabled ?? 1,
    w.agent_id ?? "intelligence"
  );
  return newId;
}

function exportSkill(db: AppDatabase, id: string): PortableBundle {
  const row = db.prepare(`SELECT * FROM ai_skills WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("Skill not found");
  return {
    version: 1,
    kind: "skill",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: String(row.name ?? id),
    data: { skill: row },
  };
}

function importSkill(db: AppDatabase, bundle: PortableBundle): string {
  const s = (bundle.data as { skill: Record<string, unknown> }).skill;
  const newId = `${s.id}-import-${uuidv4().slice(0, 6)}`;
  db.prepare(
    `INSERT INTO ai_skills (id, agent_id, name, description, body, tools_json, departments_json, enabled, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId,
    s.agent_id ?? "intelligence",
    s.name ?? newId,
    s.description ?? "",
    s.body ?? "",
    s.tools_json ?? "[]",
    s.departments_json ?? "[]",
    s.enabled ?? 1,
    s.status ?? "active"
  );
  return newId;
}

function exportRule(db: AppDatabase, id: string): PortableBundle {
  const row = db.prepare(`SELECT * FROM ai_rules WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("Rule not found");
  return {
    version: 1,
    kind: "rule",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: String(row.description ?? id),
    data: { rule: row },
  };
}

function importRule(db: AppDatabase, bundle: PortableBundle): string {
  const r = (bundle.data as { rule: Record<string, unknown> }).rule;
  const newId = `${r.id}-import-${uuidv4().slice(0, 6)}`;
  db.prepare(
    `INSERT INTO ai_rules (id, agent_id, description, body, always_apply, globs_json, departments_json, priority, enabled, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId,
    r.agent_id ?? "intelligence",
    r.description ?? newId,
    r.body ?? "",
    r.always_apply ?? 1,
    r.globs_json ?? "[]",
    r.departments_json ?? "[]",
    r.priority ?? 50,
    r.enabled ?? 1,
    r.status ?? "active"
  );
  return newId;
}

function exportArtifact(db: AppDatabase, id: string): PortableBundle {
  const row = db.prepare(`SELECT * FROM ai_artifacts WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("Artifact not found");
  let contentBase64: string | null = null;
  const filePath = String(row.path ?? "");
  if (filePath && fs.existsSync(filePath)) {
    contentBase64 = fs.readFileSync(filePath).toString("base64");
  }
  return {
    version: 1,
    kind: "artifact",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: String(row.name),
    data: { artifact: row, contentBase64 },
  };
}

function importArtifact(db: AppDatabase, bundle: PortableBundle): string {
  const { artifact, contentBase64 } = bundle.data as {
    artifact: Record<string, unknown>;
    contentBase64?: string | null;
  };
  const newId = uuidv4();
  const agentId = String(artifact.agent_id ?? "intelligence");
  const dir = agentArtifactsDir(agentId);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = String(artifact.name ?? "artifact").replace(/[^a-zA-Z0-9._-]/g, "_");
  const dest = path.join(dir, `${newId}-${fileName}`);
  if (contentBase64) {
    fs.writeFileSync(dest, Buffer.from(contentBase64, "base64"));
  }
  db.prepare(
    `INSERT INTO ai_artifacts (id, agent_id, name, kind, mime_type, path, size_bytes, description, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import')`
  ).run(
    newId,
    agentId,
    artifact.name,
    artifact.kind ?? "file",
    artifact.mime_type ?? null,
    dest,
    contentBase64 ? Buffer.from(contentBase64, "base64").length : 0,
    artifact.description ?? null
  );
  return newId;
}

function copyFileWithNewId(
  srcPath: string,
  destDir: string,
  prefix: string
): { newPath: string; newId: string } {
  const newId = `${prefix}-${uuidv4().slice(0, 8)}`;
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(srcPath) || ".bin";
  const base = path.basename(srcPath, ext).replace(/[^a-zA-Z0-9._-]/g, "_");
  const dest = path.join(destDir, `${newId}-${base}${ext}`);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, dest);
  }
  return { newPath: dest, newId };
}

function exportAdapter(db: AppDatabase, id: string): PortableBundle {
  const row = db.prepare(`SELECT * FROM ai_adapters WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("Adapter not found");
  let contentBase64: string | null = null;
  const filePath = String(row.path ?? "");
  if (filePath && fs.existsSync(filePath)) {
    contentBase64 = fs.readFileSync(filePath).toString("base64");
  }
  return {
    version: 1,
    kind: "adapter",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: String(row.name),
    data: { adapter: row, contentBase64 },
  };
}

function importAdapter(db: AppDatabase, bundle: PortableBundle): string {
  const { adapter, contentBase64 } = bundle.data as {
    adapter: Record<string, unknown>;
    contentBase64?: string | null;
  };
  const destDir = config.ai.adaptersDir;
  let destPath = String(adapter.path ?? "");
  const newId = `${adapter.id}-import-${uuidv4().slice(0, 8)}`;
  if (contentBase64) {
    fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(destPath) || ".gguf";
    destPath = path.join(destDir, `${newId}${ext}`);
    fs.writeFileSync(destPath, Buffer.from(contentBase64, "base64"));
  } else if (destPath && fs.existsSync(destPath)) {
    const copied = copyFileWithNewId(destPath, destDir, newId);
    destPath = copied.newPath;
  }
  db.prepare(
    `INSERT INTO ai_adapters (id, name, path, description, domain, enabled, default_scale)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId,
    adapter.name,
    destPath,
    adapter.description ?? null,
    adapter.domain ?? null,
    adapter.enabled ?? 1,
    adapter.default_scale ?? 1.0
  );
  return newId;
}

function exportDataset(db: AppDatabase, id: string): PortableBundle {
  const row = db.prepare(`SELECT * FROM ai_datasets WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("Dataset not found");
  let contentBase64: string | null = null;
  const filePath = String(row.path ?? "");
  if (filePath && fs.existsSync(filePath)) {
    contentBase64 = fs.readFileSync(filePath).toString("base64");
  }
  return {
    version: 1,
    kind: "dataset",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: String(row.name),
    data: { dataset: row, contentBase64 },
  };
}

function importDataset(db: AppDatabase, bundle: PortableBundle): string {
  const { dataset, contentBase64 } = bundle.data as {
    dataset: Record<string, unknown>;
    contentBase64?: string | null;
  };
  const destDir = config.ai.datasetsDir;
  const newId = `${dataset.id}-import-${uuidv4().slice(0, 8)}`;
  let destPath = String(dataset.path ?? "");
  if (contentBase64) {
    fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(destPath) || ".jsonl";
    destPath = path.join(destDir, `${newId}${ext}`);
    fs.writeFileSync(destPath, Buffer.from(contentBase64, "base64"));
  } else if (destPath && fs.existsSync(destPath)) {
    const copied = copyFileWithNewId(destPath, destDir, newId);
    destPath = copied.newPath;
  }
  db.prepare(
    `INSERT INTO ai_datasets (id, name, domain, path, row_count)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    newId,
    dataset.name,
    dataset.domain ?? null,
    destPath,
    dataset.row_count ?? 0
  );
  return newId;
}

function exportKnowledge(db: AppDatabase, id: string): PortableBundle {
  const pack = db
    .prepare(`SELECT * FROM ai_knowledge_packs WHERE id=?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!pack) throw new Error("Knowledge pack not found");
  const memories = db
    .prepare(`SELECT * FROM ai_memories WHERE pack_id=?`)
    .all(id);
  return {
    version: 1,
    kind: "knowledge",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: String(pack.name),
    data: { pack, memories },
  };
}

function importKnowledge(db: AppDatabase, bundle: PortableBundle): string {
  const { pack, memories } = bundle.data as {
    pack: Record<string, unknown>;
    memories?: Array<Record<string, unknown>>;
  };
  const newId = `${pack.id}-import-${uuidv4().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO ai_knowledge_packs (id, name, description)
     VALUES (?, ?, ?)`
  ).run(newId, pack.name, pack.description ?? null);
  for (const m of memories ?? []) {
    db.prepare(
      `INSERT INTO ai_memories (id, agent_id, scope, text, category, source, enabled, status, pack_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      m.agent_id ?? "intelligence",
      m.scope ?? "global",
      m.text,
      m.category ?? null,
      m.source ?? "import",
      m.enabled ?? 1,
      m.status ?? "active",
      newId
    );
  }
  return newId;
}

function exportPromptflow(db: AppDatabase, id: string): PortableBundle {
  const row = db.prepare(`SELECT * FROM ai_prompt_flow WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("Prompt flow not found");
  return {
    version: 1,
    kind: "promptflow",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: String(row.name ?? id),
    data: { flow: row },
  };
}

function importPromptflow(db: AppDatabase, bundle: PortableBundle): string {
  const flow = (bundle.data as { flow: Record<string, unknown> }).flow;
  const newId = `${flow.id ?? "flow"}-import-${uuidv4().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO ai_prompt_flow (id, name, config_json)
     VALUES (?, ?, ?)`
  ).run(newId, flow.name ?? newId, flow.config_json ?? "{}");
  return newId;
}

function exportBundle(db: AppDatabase, id: string): PortableBundle {
  throw new Error("Bundle export uses inline children array at publish time");
}

function importBundle(db: AppDatabase, bundle: PortableBundle): string {
  const children = (bundle.data as { children: PortableBundle[] }).children ?? [];
  const ids: string[] = [];
  for (const child of children) {
    const result = importEntity(db, child);
    ids.push(result.newId);
  }
  return ids.join(",");
}

/** Domain pack: manifest + nested portable children + connector readme. */
function exportConnectorPackage(db: AppDatabase, id: string): PortableBundle {
  const manifestPath = path.join(config.tenantWorkspacesDir, "..", "connectors", `${id}.json`);
  let manifest: Record<string, unknown> = {};
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  }
  const children = (manifest.children as PortableBundle[] | undefined) ?? [];
  return {
    version: 1,
    kind: "connector_package",
    exportedAt: new Date().toISOString(),
    sourceId: id,
    title: String(manifest.title ?? id),
    data: { manifest, children },
  };
}

function importConnectorPackage(db: AppDatabase, bundle: PortableBundle): string {
  const data = bundle.data as {
    manifest?: Record<string, unknown>;
    children?: PortableBundle[];
  };
  const children = data.children ?? [];
  const ids: string[] = [];
  for (const child of children) {
    const result = importEntity(db, child);
    ids.push(result.newId);
  }
  const connectorDir = path.join(config.dataDir, "connectors", bundle.sourceId);
  fs.mkdirSync(connectorDir, { recursive: true });
  fs.writeFileSync(
    path.join(connectorDir, "manifest.json"),
    JSON.stringify({ ...data.manifest, importedAt: new Date().toISOString(), childIds: ids }, null, 2),
    "utf8"
  );
  return bundle.sourceId;
}
