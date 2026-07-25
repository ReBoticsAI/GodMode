/**
 * Tree-sitter AST chunking for TypeScript/TSX (#69 track B).
 * Other languages fall back to capped whole-file / coarse module chunks.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { Parser, Language, type SyntaxNode } from "web-tree-sitter";

const require = createRequire(import.meta.url);

export type CodeChunkKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "module";

export interface CodeChunkDraft {
  path: string;
  language: string;
  kind: CodeChunkKind;
  symbol: string;
  startLine: number;
  endLine: number;
  text: string;
  contentHash: string;
}

const MAX_CHUNK_CHARS = 2_400;
const MAX_FILE_CHARS = 200_000;

const TS_NODE_TYPES: Array<{ type: string; kind: CodeChunkKind }> = [
  { type: "function_declaration", kind: "function" },
  { type: "generator_function_declaration", kind: "function" },
  { type: "class_declaration", kind: "class" },
  { type: "abstract_class_declaration", kind: "class" },
  { type: "method_definition", kind: "method" },
  { type: "interface_declaration", kind: "interface" },
  { type: "type_alias_declaration", kind: "type" },
  { type: "export_statement", kind: "module" },
];

let parserReady: Promise<void> | null = null;
let tsLang: Language | null = null;
let tsxLang: Language | null = null;

async function ensureParser(): Promise<void> {
  if (!parserReady) {
    parserReady = (async () => {
      const wasmCore = require.resolve("web-tree-sitter/web-tree-sitter.wasm");
      await Parser.init({
        locateFile: () => wasmCore,
      });
      const tsWasm = require.resolve(
        "tree-sitter-typescript/tree-sitter-typescript.wasm"
      );
      const tsxWasm = require.resolve("tree-sitter-typescript/tree-sitter-tsx.wasm");
      tsLang = await Language.load(tsWasm);
      tsxLang = await Language.load(tsxWasm);
    })();
  }
  await parserReady;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function splitOversized(
  base: Omit<CodeChunkDraft, "contentHash" | "text"> & { text: string }
): CodeChunkDraft[] {
  if (base.text.length <= MAX_CHUNK_CHARS) {
    return [{ ...base, contentHash: hashText(base.text) }];
  }
  const out: CodeChunkDraft[] = [];
  let offset = 0;
  let part = 0;
  while (offset < base.text.length) {
    const slice = base.text.slice(offset, offset + MAX_CHUNK_CHARS);
    const text = slice;
    out.push({
      ...base,
      symbol: part === 0 ? base.symbol : `${base.symbol}#${part}`,
      startLine: base.startLine,
      endLine: base.endLine,
      text,
      contentHash: hashText(text),
    });
    offset += MAX_CHUNK_CHARS;
    part++;
  }
  return out;
}

function symbolFromNode(node: SyntaxNode, source: string): string {
  const name = node.childForFieldName("name");
  if (name) return name.text;
  const prop = node.childForFieldName("property");
  if (prop) return prop.text;
  return source.slice(node.startIndex, Math.min(node.startIndex + 48, node.endIndex)).trim();
}

function walkTsChunks(
  node: SyntaxNode,
  source: string,
  pathRel: string,
  language: string,
  out: CodeChunkDraft[]
): void {
  const match = TS_NODE_TYPES.find((t) => t.type === node.type);
  if (match && match.type !== "export_statement") {
    const text = source.slice(node.startIndex, node.endIndex);
    if (text.trim()) {
      out.push(
        ...splitOversized({
          path: pathRel,
          language,
          kind: match.kind,
          symbol: symbolFromNode(node, source) || match.kind,
          startLine: lineOf(source, node.startIndex),
          endLine: lineOf(source, Math.max(node.endIndex - 1, node.startIndex)),
          text,
        })
      );
    }
  }
  // Prefer declared children under export_statement / lexical wrappers.
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.isNamed) walkTsChunks(child, source, pathRel, language, out);
  }
}

function coarseModuleChunks(
  pathRel: string,
  language: string,
  source: string
): CodeChunkDraft[] {
  const trimmed = source.slice(0, MAX_FILE_CHARS);
  if (!trimmed.trim()) return [];
  return splitOversized({
    path: pathRel,
    language,
    kind: "module",
    symbol: path.basename(pathRel),
    startLine: 1,
    endLine: lineOf(trimmed, Math.max(trimmed.length - 1, 0)),
    text: trimmed,
  });
}

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ts") return "typescript";
  if (ext === ".tsx") return "tsx";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".jsx") return "jsx";
  if (ext === ".py") return "python";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "rust";
  if (ext === ".md") return "markdown";
  return ext.replace(/^\./, "") || "text";
}

export function isIndexableSourcePath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  if (
    /(^|\/)(node_modules|dist|build|\.git|\.next|coverage|out)(\/|$)/i.test(norm)
  ) {
    return false;
  }
  const ext = path.extname(norm).toLowerCase();
  return [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".md",
  ].includes(ext);
}

/** Chunk a source file. Uses tree-sitter for TS/TSX; coarse fallback otherwise. */
export async function chunkSourceFile(
  pathRel: string,
  source: string
): Promise<CodeChunkDraft[]> {
  const language = detectLanguage(pathRel);
  if (!source || source.length === 0) return [];
  const capped = source.length > MAX_FILE_CHARS ? source.slice(0, MAX_FILE_CHARS) : source;

  if (language === "typescript" || language === "tsx") {
    try {
      await ensureParser();
      const parser = new Parser();
      parser.setLanguage(language === "tsx" ? tsxLang! : tsLang!);
      const tree = parser.parse(capped);
      if (!tree) throw new Error("parse returned null");
      const out: CodeChunkDraft[] = [];
      walkTsChunks(tree.rootNode, capped, pathRel, language, out);
      if (out.length > 0) return out;
    } catch {
      /* fall through */
    }
  }
  return coarseModuleChunks(pathRel, language, capped);
}
