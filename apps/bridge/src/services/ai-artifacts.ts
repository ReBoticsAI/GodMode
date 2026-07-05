import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { agentArtifactsDir, agentDir } from "../config.js";

export interface AiArtifact {
  id: string;
  agent_id: string;
  name: string;
  kind: string;
  mime_type: string | null;
  path: string;
  size_bytes: number;
  description: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface SaveArtifactInput {
  name: string;
  content: string;
  kind?: string;
  mimeType?: string;
  description?: string;
  source?: string;
}

/** Strip directory components and unsafe characters from a requested name. */
function sanitizeName(name: string): string {
  const base = path
    .basename(String(name ?? ""))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  return base || "artifact";
}

/** Resolve a name under dir, guaranteeing the result stays inside dir. */
function resolveSafe(dir: string, name: string): string {
  const target = path.resolve(dir, name);
  const rel = path.relative(dir, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid artifact path");
  }
  return target;
}

/** Create the agent's workspace + artifacts directories if missing. */
export function ensureAgentDirs(agentId: string): { dir: string; artifacts: string } {
  const dir = agentDir(agentId);
  const artifacts = agentArtifactsDir(agentId);
  fs.mkdirSync(artifacts, { recursive: true });
  return { dir, artifacts };
}

export function listArtifacts(
  db: AppDatabase,
  agentId: string,
  limit?: number
): Array<AiArtifact & { has_content?: number }> {
  const lim = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 200;
  return db
    .prepare(
      `SELECT id, agent_id, name, kind, mime_type, path, size_bytes, description, source,
              created_at, updated_at,
              CASE WHEN content IS NOT NULL AND length(content) > 0 THEN 1 ELSE 0 END AS has_content
       FROM ai_artifacts WHERE agent_id = ? ORDER BY updated_at DESC LIMIT ?`
    )
    .all(agentId, lim) as Array<AiArtifact & { has_content?: number }>;
}

export function getArtifact(
  db: AppDatabase,
  agentId: string,
  idOrName: string
): AiArtifact | null {
  const byId = db
    .prepare(`SELECT * FROM ai_artifacts WHERE agent_id = ? AND id = ?`)
    .get(agentId, idOrName) as AiArtifact | undefined;
  if (byId) return byId;
  const byName = db
    .prepare(
      `SELECT * FROM ai_artifacts WHERE agent_id = ? AND name = ? ORDER BY updated_at DESC LIMIT 1`
    )
    .get(agentId, idOrName) as AiArtifact | undefined;
  return byName ?? null;
}

/**
 * Write an artifact file under the agent's artifacts dir and register (or
 * update) its metadata row. Saving with an existing name overwrites the file.
 */
export function saveArtifact(
  db: AppDatabase,
  agentId: string,
  input: SaveArtifactInput
): AiArtifact {
  const name = sanitizeName(input.name);
  const { artifacts } = ensureAgentDirs(agentId);
  const filePath = resolveSafe(artifacts, name);
  const content = String(input.content ?? "");
  fs.writeFileSync(filePath, content, "utf8");
  const size = Buffer.byteLength(content, "utf8");
  const kind = input.kind ? String(input.kind) : "file";
  const mimeType = input.mimeType ? String(input.mimeType) : null;
  const description = input.description ? String(input.description) : null;
  const source = input.source ? String(input.source) : "agent";

  const existing = db
    .prepare(`SELECT id FROM ai_artifacts WHERE agent_id = ? AND name = ?`)
    .get(agentId, name) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE ai_artifacts
       SET kind = ?, mime_type = ?, path = ?, size_bytes = ?, description = ?, source = ?, content = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(kind, mimeType, filePath, size, description, source, content, existing.id);
    return db
      .prepare(`SELECT * FROM ai_artifacts WHERE id = ?`)
      .get(existing.id) as AiArtifact;
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO ai_artifacts (id, agent_id, name, kind, mime_type, path, size_bytes, description, source, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, agentId, name, kind, mimeType, filePath, size, description, source, content);
  return db.prepare(`SELECT * FROM ai_artifacts WHERE id = ?`).get(id) as AiArtifact;
}

export function readArtifact(
  db: AppDatabase,
  agentId: string,
  idOrName: string
): { artifact: AiArtifact; content: string } {
  const artifact = getArtifact(db, agentId, idOrName);
  if (!artifact) throw new Error(`Artifact not found: ${idOrName}`);
  const row = db
    .prepare(`SELECT content FROM ai_artifacts WHERE id = ?`)
    .get(artifact.id) as { content: string | null } | undefined;
  if (row?.content != null && row.content !== "") {
    return { artifact, content: row.content };
  }
  const { artifacts } = ensureAgentDirs(agentId);
  const filePath = resolveSafe(artifacts, sanitizeName(artifact.name));
  if (!fs.existsSync(filePath)) throw new Error(`Artifact file missing: ${artifact.name}`);
  const content = fs.readFileSync(filePath, "utf8");
  return { artifact, content };
}

export function deleteArtifact(
  db: AppDatabase,
  agentId: string,
  id: string
): boolean {
  const artifact = getArtifact(db, agentId, id);
  if (!artifact) return false;
  try {
    const { artifacts } = ensureAgentDirs(agentId);
    const filePath = resolveSafe(artifacts, sanitizeName(artifact.name));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* tolerate missing file */
  }
  const r = db
    .prepare(`DELETE FROM ai_artifacts WHERE agent_id = ? AND id = ?`)
    .run(agentId, artifact.id);
  return r.changes > 0;
}
