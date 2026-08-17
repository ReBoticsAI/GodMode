import {
  parsePublisherConnectorDef,
  type PublisherConnectorDef,
} from "@godmode/plugin-api";

const catalog = new Map<string, PublisherConnectorDef>();
let coreSeeded = false;

export const GITHUB_RELEASES_CONNECTOR_ID = "github-releases";

export const GITHUB_RELEASES_CONNECTOR: PublisherConnectorDef =
  parsePublisherConnectorDef({
    id: GITHUB_RELEASES_CONNECTOR_ID,
    title: "GitHub Releases",
    description:
      "Draft-first GitHub Releases via Vault GitHub Connect. Core Near proof for store submit + metrics.",
    kind: "store",
    source: "core",
    installHint:
      "Core. Connect GitHub in Vault, then github_release_prepare → github_release_create (draft) → github_release_publish.",
    vaultConnect: "github",
    tools: {
      prepare: "github_release_prepare",
      submit: "github_release_create",
      publish: "github_release_publish",
      list: "github_release_list",
    },
    pagePath: "/releases",
    pageKind: "release-console",
    neverAutoApprove: ["github_release_create", "github_release_publish"],
    docsPath: "docs/features/release-submission.md",
  });

export function seedCorePublisherConnectors(): void {
  if (coreSeeded) return;
  catalog.set(GITHUB_RELEASES_CONNECTOR.id, GITHUB_RELEASES_CONNECTOR);
  coreSeeded = true;
}

export function registerPublisherConnector(
  raw: unknown,
  opts?: { pluginId?: string }
): PublisherConnectorDef {
  const parsed = parsePublisherConnectorDef(raw);
  const pluginId = opts?.pluginId?.trim();
  const def: PublisherConnectorDef = pluginId
    ? {
        ...parsed,
        source: "plugin",
        pluginId,
      }
    : parsed;
  if (def.source === "plugin" && !def.pluginId) {
    throw new Error("plugin publisher connectors require pluginId");
  }
  const existing = catalog.get(def.id);
  if (existing?.source === "core" && def.source !== "core") {
    throw new Error(`publisher connector id is reserved by Core: ${def.id}`);
  }
  if (
    existing &&
    existing.pluginId &&
    def.pluginId &&
    existing.pluginId !== def.pluginId
  ) {
    throw new Error(
      `publisher connector ${def.id} is already registered by ${existing.pluginId}`
    );
  }
  catalog.set(def.id, def);
  return def;
}

export function unregisterPublisherConnectors(pluginId: string): void {
  const id = pluginId.trim();
  if (!id) return;
  for (const [key, def] of catalog) {
    if (def.pluginId === id) catalog.delete(key);
  }
}

export function listPublisherConnectors(): PublisherConnectorDef[] {
  seedCorePublisherConnectors();
  return [...catalog.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Test helper: drop plugin rows and re-seed Core. */
export function resetPublisherConnectorsForTests(): void {
  catalog.clear();
  coreSeeded = false;
  seedCorePublisherConnectors();
}
