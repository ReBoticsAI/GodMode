import { PAGE_KINDS } from "../services/page-kinds.js";

/**
 * Shared Kind registry for StructureNode.kind / page renderers.
 * Bridge starts with built-in PAGE_KINDS; plugins and web sync add more.
 */
const kinds = new Set<string>(PAGE_KINDS);

export function registerPageKind(kind: string): void {
  const k = kind.trim();
  if (!k) return;
  kinds.add(k);
}

export function registerPageKinds(list: string[]): void {
  for (const k of list) registerPageKind(k);
}

export function unregisterPageKind(kind: string): void {
  if ((PAGE_KINDS as readonly string[]).includes(kind)) return;
  kinds.delete(kind);
}

export function listPageKinds(): string[] {
  return [...kinds].sort();
}

export function isRegisteredPageKind(kind: string): boolean {
  return kinds.has(kind);
}

export function pageKindJsonSchema(): { type: "string"; enum?: string[] } {
  const enumVals = listPageKinds();
  if (enumVals.length === 0) return { type: "string" };
  return { type: "string", enum: enumVals };
}
