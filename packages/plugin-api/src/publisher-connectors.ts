/** Publisher / store console catalog (#446). Plugins register; Core does not grow vendor consoles. */

export type PublisherConnectorKind = "store" | "channel";
export type PublisherConnectorSource = "core" | "plugin";

export interface PublisherConnectorTools {
  /** Stage payload without submitting. */
  prepare?: string;
  /** Confirm-gated create / upload / post. Never auto-approve when irreversible. */
  submit: string;
  /** Optional second confirm to go live (draft → published). */
  publish?: string;
  /** List submissions and pull metrics. */
  list?: string;
}

export interface PublisherConnectorDef {
  id: string;
  title: string;
  description: string;
  kind: PublisherConnectorKind;
  source: PublisherConnectorSource;
  pluginId?: string;
  /** How Intelligence should enable this connector (Vault Connect, catalog install, etc.). */
  installHint: string;
  vaultConnect?: string;
  vaultSecretId?: string;
  tools: PublisherConnectorTools;
  pagePath?: string;
  pageKind?: string;
  neverAutoApprove?: string[];
  docsPath?: string;
}

const ID_RE = /^[a-z][a-z0-9-]{1,62}$/;

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`publisher connector ${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error("publisher connector optional string fields must be strings");
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parsePublisherConnectorDef(
  raw: unknown
): PublisherConnectorDef {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("publisher connector must be an object");
  }
  const rec = raw as Record<string, unknown>;
  const id = requireString(rec.id, "id");
  if (!ID_RE.test(id)) {
    throw new Error(`publisher connector id must be kebab-case: ${id}`);
  }
  const kind = requireString(rec.kind, "kind");
  if (kind !== "store" && kind !== "channel") {
    throw new Error(`publisher connector kind must be store or channel: ${kind}`);
  }
  const source = requireString(rec.source, "source");
  if (source !== "core" && source !== "plugin") {
    throw new Error(`publisher connector source must be core or plugin: ${source}`);
  }
  const toolsRaw = rec.tools;
  if (!toolsRaw || typeof toolsRaw !== "object" || Array.isArray(toolsRaw)) {
    throw new Error("publisher connector tools is required");
  }
  const toolsObj = toolsRaw as Record<string, unknown>;
  const submit = requireString(toolsObj.submit, "tools.submit");
  const tools: PublisherConnectorTools = {
    submit,
    prepare: optionalString(toolsObj.prepare),
    publish: optionalString(toolsObj.publish),
    list: optionalString(toolsObj.list),
  };
  const neverAutoApprove = Array.isArray(rec.neverAutoApprove)
    ? rec.neverAutoApprove.map((n) => requireString(n, "neverAutoApprove[]"))
    : undefined;
  if (neverAutoApprove && !neverAutoApprove.includes(submit)) {
    throw new Error("neverAutoApprove must include tools.submit");
  }
  if (tools.publish && neverAutoApprove && !neverAutoApprove.includes(tools.publish)) {
    throw new Error("neverAutoApprove must include tools.publish when set");
  }
  const pluginId = optionalString(rec.pluginId);
  return {
    id,
    title: requireString(rec.title, "title"),
    description: requireString(rec.description, "description"),
    kind,
    source,
    pluginId,
    installHint: requireString(rec.installHint, "installHint"),
    vaultConnect: optionalString(rec.vaultConnect),
    vaultSecretId: optionalString(rec.vaultSecretId),
    tools,
    pagePath: optionalString(rec.pagePath),
    pageKind: optionalString(rec.pageKind),
    neverAutoApprove,
    docsPath: optionalString(rec.docsPath),
  };
}
