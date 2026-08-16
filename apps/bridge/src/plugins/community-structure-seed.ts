import type { AppDatabase } from "../db.js";
import { insertIgnoreStructureNode } from "../services/structure.js";

const ALLOWED_COLUMNS = new Set([
  "id",
  "parent_id",
  "label",
  "icon",
  "segment",
  "kind",
  "object_type",
  "right_sidebar",
  "agent_id",
  "built_in",
  "sort_order",
  "tabs_json",
]);

const INSERT_RE =
  /^INSERT\s+OR\s+IGNORE\s+INTO\s+structure_nodes\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*)\)$/i;

export class CommunityStructureSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommunityStructureSeedError";
  }
}

function skipWs(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i]!)) i += 1;
  return i;
}

function parseSqlString(src: string, start: number): { value: string; next: number } {
  let i = start + 1;
  let out = "";
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "'") {
      if (src[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      return { value: out, next: i + 1 };
    }
    out += ch;
    i += 1;
  }
  throw new CommunityStructureSeedError(
    "Community structure seed SQL has an unterminated string"
  );
}

function parseValueList(src: string): unknown[] {
  const values: unknown[] = [];
  let i = skipWs(src, 0);
  if (i >= src.length) {
    throw new CommunityStructureSeedError(
      "Community structure seed SQL VALUES list is empty"
    );
  }
  while (i < src.length) {
    i = skipWs(src, i);
    const ch = src[i];
    if (ch === "?") {
      values.push({ __bind: true });
      i += 1;
    } else if (/^null\b/i.test(src.slice(i))) {
      values.push(null);
      i += 4;
    } else if (ch === "'") {
      const parsed = parseSqlString(src, i);
      values.push(parsed.value);
      i = parsed.next;
    } else if (ch === "-" || (ch != null && /[0-9]/.test(ch))) {
      const m = src.slice(i).match(/^-?\d+(?:\.\d+)?/);
      if (!m) {
        throw new CommunityStructureSeedError(
          "Community structure seed SQL has an invalid number"
        );
      }
      values.push(Number(m[0]));
      i += m[0].length;
    } else {
      throw new CommunityStructureSeedError(
        "Community plugin child can only INSERT OR IGNORE INTO structure_nodes with bound params or simple literals"
      );
    }
    i = skipWs(src, i);
    if (i >= src.length) break;
    if (src[i] !== ",") {
      throw new CommunityStructureSeedError(
        "Community structure seed SQL VALUES list is malformed"
      );
    }
    i += 1;
  }
  return values;
}

/**
 * Parse the Community tenant:install SQLite shape used by scaffold and
 * published plugins. The child never receives a live DB handle; Bridge
 * re-binds a parameterized INSERT OR IGNORE on the parent tenant DB.
 */
export function parseCommunityStructureInsert(
  sql: string,
  params: unknown[]
): { columns: string[]; values: unknown[] } {
  const trimmed = String(sql ?? "")
    .trim()
    .replace(/;+\s*$/, "");
  const match = trimmed.match(INSERT_RE);
  if (!match) {
    throw new CommunityStructureSeedError(
      "Community plugin child can only INSERT OR IGNORE INTO structure_nodes. Use api.kernel.create or manifest records instead."
    );
  }
  const columns = match[1]!.split(",").map((c) => c.trim().toLowerCase());
  if (columns.length === 0 || columns.some((c) => !ALLOWED_COLUMNS.has(c))) {
    throw new CommunityStructureSeedError(
      "Community structure seed SQL uses a disallowed structure_nodes column"
    );
  }
  if (new Set(columns).size !== columns.length) {
    throw new CommunityStructureSeedError(
      "Community structure seed SQL repeats a column"
    );
  }
  const tokens = parseValueList(match[2]!);
  if (tokens.length !== columns.length) {
    throw new CommunityStructureSeedError(
      "Community structure seed SQL column/value count mismatch"
    );
  }
  const binds = params ?? [];
  let bindIndex = 0;
  const values = tokens.map((token) => {
    if (token && typeof token === "object" && (token as { __bind?: boolean }).__bind) {
      if (bindIndex >= binds.length) {
        throw new CommunityStructureSeedError(
          "Community structure seed SQL is missing bound parameters"
        );
      }
      const bound = binds[bindIndex];
      bindIndex += 1;
      return bound === undefined ? null : bound;
    }
    return token;
  });
  if (bindIndex !== binds.length) {
    throw new CommunityStructureSeedError(
      "Community structure seed SQL has extra bound parameters"
    );
  }
  if (!columns.includes("id") || values[columns.indexOf("id")] == null) {
    throw new CommunityStructureSeedError(
      "Community structure seed SQL requires an id"
    );
  }
  return { columns, values };
}

function valueAt(
  columns: string[],
  values: unknown[],
  name: string
): unknown {
  const index = columns.indexOf(name);
  return index >= 0 ? values[index] : undefined;
}

function optionalString(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

export function applyCommunityStructureInsert(
  db: AppDatabase,
  sql: string,
  params: unknown[]
): { ignored: boolean } {
  const { columns, values } = parseCommunityStructureInsert(sql, params);
  const parentRaw = valueAt(columns, values, "parent_id");
  const builtIn = valueAt(columns, values, "built_in");
  const sortOrder = valueAt(columns, values, "sort_order");
  return insertIgnoreStructureNode(db, {
    id: String(valueAt(columns, values, "id") ?? ""),
    parentId: optionalString(parentRaw),
    label: String(valueAt(columns, values, "label") ?? ""),
    icon: String(valueAt(columns, values, "icon") ?? "folder"),
    segment: String(valueAt(columns, values, "segment") ?? ""),
    kind: String(valueAt(columns, values, "kind") ?? "placeholder"),
    objectType: optionalString(valueAt(columns, values, "object_type")),
    rightSidebar: optionalString(valueAt(columns, values, "right_sidebar")),
    agentId: optionalString(valueAt(columns, values, "agent_id")),
    builtIn: typeof builtIn === "number" ? builtIn : Number(builtIn ?? 0) || 0,
    sortOrder:
      typeof sortOrder === "number" ? sortOrder : Number(sortOrder ?? 0) || 0,
    tabsJson: optionalString(valueAt(columns, values, "tabs_json")),
  });
}
