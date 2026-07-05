/**
 * JSON-schema for grammar-constrained tool decoding on llama-server.
 * Used when toolMode=grammar (cannot combine with native `tools` in one request).
 */

export type ToolMode = "native" | "grammar";

export interface GrammarToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * Reduce a registry parameter schema to the grammar-safe subset llama.cpp's
 * json-schema→GBNF converter handles reliably. Keeps `properties`, `required`,
 * `enum`, and `items`; collapses union `type: ["string","null"]` to its first
 * concrete type; and drops deep/unknown constructs to a permissive object so a
 * single odd field can never make the whole constrained request fail to parse
 * (which would silently fall back to UNconstrained decoding — the path where
 * the model hallucinates tool names and emits empty args).
 */
function sanitizeParamSchema(schema: unknown, depth = 0): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", additionalProperties: true };
  }
  const s = schema as Record<string, unknown>;
  // Collapse union types ("string"|"null") to the first non-null concrete type.
  let type = s.type;
  if (Array.isArray(type)) {
    type = (type as unknown[]).find((t) => t !== "null") ?? "string";
  }

  if (type === "object" || s.properties) {
    const props = (s.properties as Record<string, unknown>) ?? {};
    // Bail out to a permissive object for deeply-nested / free-form objects so
    // the grammar stays compact and robust.
    if (depth >= 2 || Object.keys(props).length === 0) {
      return { type: "object", additionalProperties: true };
    }
    const outProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      outProps[k] = sanitizeProp(v, depth + 1);
    }
    const required = Array.isArray(s.required)
      ? (s.required as unknown[]).map(String).filter((r) => r in outProps)
      : [];
    return {
      type: "object",
      properties: outProps,
      ...(required.length ? { required } : {}),
      // Allow extra keys so a model that adds a stray field is not rejected
      // structurally; required-arg enforcement is what we care about.
      additionalProperties: true,
    };
  }

  return sanitizeProp(s, depth);
}

function sanitizeProp(prop: unknown, depth: number): Record<string, unknown> {
  if (!prop || typeof prop !== "object" || Array.isArray(prop)) {
    return {};
  }
  const p = prop as Record<string, unknown>;
  let type = p.type;
  if (Array.isArray(type)) {
    type = (type as unknown[]).find((t) => t !== "null") ?? "string";
  }
  if (Array.isArray(p.enum) && (p.enum as unknown[]).length) {
    return { enum: p.enum };
  }
  if (type === "object" || p.properties) {
    return sanitizeParamSchema({ ...p, type: "object" }, depth);
  }
  if (type === "array") {
    return { type: "array", items: sanitizeProp(p.items, depth + 1) };
  }
  if (type === "string" || type === "number" || type === "boolean" || type === "integer") {
    return { type };
  }
  return {};
}

/** A constrained `arguments` object for one tool: required args enforced. */
function argsSchemaForTool(tool: GrammarToolSchema): Record<string, unknown> {
  const params = tool.function.parameters;
  if (!params || typeof params !== "object") {
    return { type: "object", additionalProperties: true };
  }
  return sanitizeParamSchema(params);
}

export function buildGrammarResponseSchema(
  tools: GrammarToolSchema[]
): Record<string, unknown> {
  const names = tools.map((t) => t.function.name);

  // Per-tool branches pin `name` to a const and constrain `arguments` to that
  // tool's parameter schema (required props included). This structurally blocks
  // the two local-model failure modes: (1) emitting a tool name that isn't
  // registered, and (2) calling a tool with empty/missing required arguments.
  const toolBranches = tools.map((t) => ({
    type: "object",
    properties: {
      name: { const: t.function.name },
      arguments: argsSchemaForTool(t),
    },
    required: ["name", "arguments"],
    additionalProperties: false,
  }));

  const callSchema: Record<string, unknown> = toolBranches.length
    ? { oneOf: toolBranches }
    : {
        type: "object",
        properties: {
          name: names.length ? { enum: names } : { type: "string" },
          arguments: { type: "object", additionalProperties: true },
        },
        required: ["name", "arguments"],
      };

  // Single-call form, one branch per tool so the required-args + name-const
  // enforcement also applies to the (more common) single `tool_call` emission.
  const singleToolBranches = tools.map((t) => ({
    type: "object",
    properties: {
      type: { const: "tool_call" },
      name: { const: t.function.name },
      arguments: argsSchemaForTool(t),
    },
    required: ["type", "name", "arguments"],
    additionalProperties: false,
  }));

  const finalBranch = {
    type: "object",
    properties: {
      type: { const: "final" },
      content: { type: "string" },
    },
    required: ["type", "content"],
    additionalProperties: false,
  };

  const toolCallsBranch = {
    type: "object",
    properties: {
      type: { const: "tool_calls" },
      calls: { type: "array", items: callSchema },
    },
    required: ["type", "calls"],
    additionalProperties: false,
  };

  const genericSingle = {
    type: "object",
    properties: {
      type: { const: "tool_call" },
      name: names.length ? { enum: names } : { type: "string" },
      arguments: { type: "object", additionalProperties: true },
    },
    required: ["type", "name", "arguments"],
    additionalProperties: false,
  };

  return {
    type: "object",
    oneOf: [
      finalBranch,
      ...(singleToolBranches.length ? singleToolBranches : [genericSingle]),
      toolCallsBranch,
    ],
  };
}

export function grammarToolsIndexText(tools: GrammarToolSchema[]): string {
  const lines = tools.map((t) => {
    const params = JSON.stringify(t.function.parameters ?? {}, null, 0);
    return `- ${t.function.name}: ${t.function.description} Parameters: ${params}`;
  });
  return [
    "Available tools (respond with JSON matching the constrained schema):",
    ...lines,
  ].join("\n");
}

export interface ParsedGrammarResponse {
  content: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}

function objectArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Repair the pseudo-token quoting some local chat templates emit inside a tool
 * call, e.g. `{playbook_id:<|"|>pb1<|"|>}`. The model substitutes the literal
 * quote character with a `<|"|>` / `<|'|>` control-token rendering, which makes
 * the argument JSON unparseable. Map those back to real quotes and quote any
 * bare object keys so the arguments survive `JSON.parse` instead of being
 * silently dropped to `{}`.
 */
function repairArgText(argText: string): string {
  return argText
    .replace(/<\|\s*(["'])\s*\|>/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
}

function tryParseArgs(argText: string): Record<string, unknown> | null {
  for (const candidate of [argText, repairArgText(argText)]) {
    try {
      return objectArgs(JSON.parse(candidate));
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function parseToolCallBody(
  body: string
): { name: string; arguments: Record<string, unknown> } | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    const parsed = tryParseArgs(trimmed) as Record<string, unknown> | null;
    if (!parsed) return null;
    const name = String(parsed.name ?? parsed.tool ?? "");
    if (!name) return null;
    return {
      name,
      arguments: objectArgs(parsed.arguments ?? parsed.args ?? parsed.input),
    };
  }

  const callMatch = trimmed.match(
    /^(?:call:)?([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\(([\s\S]*)\)|(\{[\s\S]*\}))$/
  );
  if (!callMatch) return null;

  const [, name, parenArgs = "", braceArgs = ""] = callMatch;
  const argTextRaw = parenArgs || braceArgs;
  const argText = argTextRaw.trim();
  if (!argText) return { name, arguments: {} };

  return { name, arguments: tryParseArgs(argText) ?? {} };
}

// Tag names local chat templates use to wrap a tool call. Models are wildly
// inconsistent here (`<|tool_call>…<tool_call|>`, `<tool_call>…</tool_call>`,
// `<tool_calling>…</tool_calling>`, `<tool_use>…`), so match them all. Longest
// first so the alternation never stops at a shorter prefix (tool_call vs
// tool_calling).
const TOOL_TAG = "(?:tool_calling|tool_calls|tool_call|tool_use|function_call)";
const TOOL_BLOCK_RE = new RegExp(
  `<\\|?\\/?${TOOL_TAG}\\|?>\\s*([\\s\\S]*?)(?:<\\|?\\/?${TOOL_TAG}\\|?>|\\{\\/?${TOOL_TAG}\\})`,
  "gi"
);

function parseTemplateToolCalls(raw: string): ParsedGrammarResponse | null {
  const toolCalls: ParsedGrammarResponse["toolCalls"] = [];
  let withoutBlocks = raw.replace(TOOL_BLOCK_RE, (_full, body: string) => {
    const call = parseToolCallBody(body);
    if (call) toolCalls.push(call);
    return "";
  });

  // Bare emissions without a (matching) wrapper, e.g. `call:get_playbooks{}` or
  // `get_playbooks(...)` on their own. Some local models drop or mangle the
  // `<|tool_call|>` tags, so a `call:`-prefixed token (or a bare `name(args)` /
  // `name{args}` line) should still dispatch instead of rendering as prose.
  const bareRe =
    /(?:^|[\s>])call:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(\{[\s\S]*?\}|\([\s\S]*?\))/g;
  withoutBlocks = withoutBlocks.replace(bareRe, (_full, name: string, args: string) => {
    const call = parseToolCallBody(`${name}${args}`);
    if (call) toolCalls.push(call);
    return "";
  });

  if (!toolCalls.length) return null;
  return { content: withoutBlocks.trim(), toolCalls };
}

/**
 * Last-resort scrub for an UNTERMINATED tool-call fragment the structured
 * parsers can't match because the model was truncated mid-call, e.g.
 * `<|tool_call>call:move_project_card{cardId:<|"|>todo_81` with no closing tag
 * or brace. A tool-call opener means the model switched into tool mode, so any
 * trailing text from that marker is broken call syntax — strip it to end so it
 * never leaks into the visible answer. Returns the cleaned content; the broken
 * call is intentionally NOT executed (its args are incomplete).
 */
function stripDanglingToolSyntax(content: string): string {
  if (!content) return content;
  let out = content;
  // An opening tool tag (any of the known variants) with no closer.
  out = out.replace(
    /<\|?\/?(?:tool_calling|tool_calls|tool_call|tool_use|function_call)\|?>[\s\S]*$/i,
    ""
  );
  // A bare `call:name{...` / `call:name(...` opener with no closer.
  out = out.replace(
    /(?:^|[\s>])call:\s*[A-Za-z_][A-Za-z0-9_-]*\s*[{(][\s\S]*$/i,
    ""
  );
  return out.trim();
}

export function parseGrammarResponse(raw: string): ParsedGrammarResponse {
  const result = parseGrammarResponseInner(raw);
  return { ...result, content: stripDanglingToolSyntax(result.content) };
}

function parseGrammarResponseInner(raw: string): ParsedGrammarResponse {
  const trimmed = raw.trim();
  const templateCalls = parseTemplateToolCalls(trimmed);
  if (templateCalls) return templateCalls;

  let parsed: Record<string, unknown>;
  try {
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    const slice =
      jsonStart >= 0 && jsonEnd > jsonStart
        ? trimmed.slice(jsonStart, jsonEnd + 1)
        : trimmed;
    parsed = JSON.parse(slice) as Record<string, unknown>;
  } catch {
    return { content: trimmed, toolCalls: [] };
  }

  const type = String(parsed.type ?? "");
  if (type === "final") {
    return { content: String(parsed.content ?? ""), toolCalls: [] };
  }
  if (type === "tool_call") {
    const name = String(parsed.name ?? "");
    const args = objectArgs(parsed.arguments);
    return { content: "", toolCalls: name ? [{ name, arguments: args }] : [] };
  }
  if (type === "tool_calls" && Array.isArray(parsed.calls)) {
    const toolCalls = (parsed.calls as unknown[])
      .map((c) => {
        if (!c || typeof c !== "object") return null;
        const o = c as Record<string, unknown>;
        const name = String(o.name ?? "");
        if (!name) return null;
        const args = objectArgs(o.arguments);
        return { name, arguments: args };
      })
      .filter((x): x is { name: string; arguments: Record<string, unknown> } => x != null);
    return { content: "", toolCalls };
  }
  if (!type && typeof parsed.name === "string") {
    return {
      content: "",
      toolCalls: [
        {
          name: parsed.name,
          arguments: objectArgs(parsed.arguments ?? parsed.args ?? parsed.input),
        },
      ],
    };
  }
  if (!type && Array.isArray(parsed.calls)) {
    const toolCalls = (parsed.calls as unknown[])
      .map((c) => {
        if (!c || typeof c !== "object") return null;
        const o = c as Record<string, unknown>;
        const name = String(o.name ?? "");
        if (!name) return null;
        return {
          name,
          arguments: objectArgs(o.arguments ?? o.args ?? o.input),
        };
      })
      .filter((x): x is { name: string; arguments: Record<string, unknown> } => x != null);
    if (toolCalls.length) return { content: "", toolCalls };
  }
  return { content: trimmed, toolCalls: [] };
}
