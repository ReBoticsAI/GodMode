import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import type { AppDatabase } from "../db.js";

export type DatasetSource = "chats" | "workflows" | "queue" | "comments";

export interface DatasetExampleMessage {
  role: string;
  content: string;
}

export interface DatasetExample {
  messages: DatasetExampleMessage[];
}

export interface DatasetSourceInfo {
  source: DatasetSource;
  label: string;
  count: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  message_count: number;
  updated_at: string;
}

export interface DatasetRow {
  id: string;
  name: string;
  domain: string | null;
  path: string;
  row_count: number;
  created_at: string;
  updated_at: string;
}

interface PreviewOptions {
  limit?: number;
  chatIds?: string[];
}

interface BuildOptions {
  name: string;
  domain?: string;
  source: DatasetSource;
  chatIds?: string[];
  limit?: number;
}

const SOURCE_LABELS: Record<DatasetSource, string> = {
  chats: "Intelligence chats",
  workflows: "Workflow runs",
  queue: "Prompt queue jobs",
  comments: "Card comments (user → agent)",
};

/**
 * Recursively coerces a decoded content value to plain text. Handles the
 * shapes the platform actually writes: user messages ({text, images}),
 * assistant messages ({content, thinking, answer}), structured part arrays
 * ([{type,text}] / [{text}]), and run results ({output} / {content}).
 */
function coerceText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (typeof p.content === "string") return p.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.answer === "string" && o.answer.trim()) return o.answer;
    if (typeof o.text === "string") return o.text;
    if (o.content !== undefined) return coerceText(o.content);
    if (o.output !== undefined) return coerceText(o.output);
    return "";
  }
  return "";
}

/** Parses a raw stored content_json/result_json value into plain text. */
export function extractText(contentJson: unknown): string {
  let value: unknown = contentJson;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }
  return coerceText(value).trim();
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "dataset"
  );
}

interface MessageRow {
  chat_id: string;
  role: string;
  content_json: string;
}

interface PairRow {
  prompt: string | null;
  result: string | null;
}

interface CommentRow {
  card_id: string;
  author: string;
  body: string;
}

export class AiDatasetBuilder {
  constructor(private readonly db: AppDatabase) {}

  /** Source rows available per source, used to populate the picker. */
  listSources(): DatasetSourceInfo[] {
    const chats = this.db
      .prepare(
        `SELECT COUNT(DISTINCT chat_id) AS n FROM ai_messages WHERE role IN ('user','assistant')`
      )
      .get() as { n: number };
    const workflows = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ai_workflow_runs WHERE status = 'done' AND result_json IS NOT NULL`
      )
      .get() as { n: number };
    const queue = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ai_prompt_queue WHERE status = 'done' AND result_json IS NOT NULL AND prompt IS NOT NULL`
      )
      .get() as { n: number };
    const comments = this.db
      .prepare(`SELECT COUNT(*) AS n FROM ai_card_comments WHERE author = 'agent'`)
      .get() as { n: number };
    return [
      { source: "chats", label: SOURCE_LABELS.chats, count: chats.n },
      { source: "workflows", label: SOURCE_LABELS.workflows, count: workflows.n },
      { source: "queue", label: SOURCE_LABELS.queue, count: queue.n },
      { source: "comments", label: SOURCE_LABELS.comments, count: comments.n },
    ];
  }

  /** ai_chats with a message count, for the chats-source selection UI. */
  listChats(): ChatSummary[] {
    return this.db
      .prepare(
        `SELECT c.id AS id, c.title AS title, c.updated_at AS updated_at,
                (SELECT COUNT(*) FROM ai_messages m WHERE m.chat_id = c.id) AS message_count
         FROM ai_chats c ORDER BY c.updated_at DESC`
      )
      .all() as ChatSummary[];
  }

  private buildFromChats(chatIds?: string[]): DatasetExample[] {
    const rows = this.db
      .prepare(
        `SELECT chat_id, role, content_json FROM ai_messages
         WHERE role IN ('user','assistant')
         ORDER BY chat_id ASC, created_at ASC`
      )
      .all() as MessageRow[];
    const filter = chatIds && chatIds.length ? new Set(chatIds) : null;
    const byChat = new Map<string, DatasetExampleMessage[]>();
    for (const row of rows) {
      if (filter && !filter.has(row.chat_id)) continue;
      const text = extractText(row.content_json);
      if (!text) continue;
      const list = byChat.get(row.chat_id) ?? [];
      list.push({ role: row.role, content: text });
      byChat.set(row.chat_id, list);
    }
    const examples: DatasetExample[] = [];
    for (const messages of byChat.values()) {
      if (messages.length >= 2) examples.push({ messages });
    }
    return examples;
  }

  private buildFromPairs(source: "workflows" | "queue"): DatasetExample[] {
    const sql =
      source === "workflows"
        ? `SELECT trigger_input AS prompt, result_json AS result FROM ai_workflow_runs
           WHERE status = 'done' AND result_json IS NOT NULL ORDER BY created_at DESC`
        : `SELECT prompt AS prompt, result_json AS result FROM ai_prompt_queue
           WHERE status = 'done' AND result_json IS NOT NULL AND prompt IS NOT NULL
           ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all() as PairRow[];
    const examples: DatasetExample[] = [];
    for (const row of rows) {
      const user = extractText(row.prompt);
      const assistant = extractText(row.result);
      if (!user || !assistant) continue;
      examples.push({
        messages: [
          { role: "user", content: user },
          { role: "assistant", content: assistant },
        ],
      });
    }
    return examples;
  }

  private buildFromComments(): DatasetExample[] {
    const rows = this.db
      .prepare(
        `SELECT card_id, author, body FROM ai_card_comments ORDER BY card_id ASC, created_at ASC`
      )
      .all() as CommentRow[];
    const examples: DatasetExample[] = [];
    let pendingUser: string | null = null;
    let currentCard: string | null = null;
    for (const row of rows) {
      if (row.card_id !== currentCard) {
        currentCard = row.card_id;
        pendingUser = null;
      }
      const body = extractText(row.body);
      if (!body) continue;
      if (row.author === "agent") {
        if (pendingUser) {
          examples.push({
            messages: [
              { role: "user", content: pendingUser },
              { role: "assistant", content: body },
            ],
          });
          pendingUser = null;
        }
      } else {
        pendingUser = body;
      }
    }
    return examples;
  }

  buildExamples(source: DatasetSource, opts: PreviewOptions = {}): DatasetExample[] {
    switch (source) {
      case "chats":
        return this.buildFromChats(opts.chatIds);
      case "workflows":
        return this.buildFromPairs("workflows");
      case "queue":
        return this.buildFromPairs("queue");
      case "comments":
        return this.buildFromComments();
      default:
        return [];
    }
  }

  previewSource(
    source: DatasetSource,
    opts: PreviewOptions = {}
  ): { examples: DatasetExample[]; total: number } {
    const all = this.buildExamples(source, opts);
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
    return { examples: all.slice(0, limit), total: all.length };
  }

  buildDataset(opts: BuildOptions): DatasetRow {
    const name = opts.name.trim();
    if (!name) throw new Error("name required");
    let examples = this.buildExamples(opts.source, { chatIds: opts.chatIds });
    if (opts.limit && opts.limit > 0) examples = examples.slice(0, opts.limit);
    if (examples.length === 0) {
      throw new Error("No examples produced for this source");
    }

    const dir = config.ai.datasetsDir;
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${slug(name)}.jsonl`);
    const lines = examples.map((ex) => JSON.stringify({ messages: ex.messages }));
    fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");

    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO ai_datasets (id, name, domain, path, row_count) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, name, opts.domain?.trim() || null, filePath, lines.length);
    return this.db.prepare(`SELECT * FROM ai_datasets WHERE id = ?`).get(id) as DatasetRow;
  }
}
