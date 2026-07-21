/**
 * Generic local connector interface for hardware-bound marketplace plugins.
 * Each domain pack ships a connector manifest; this runtime forwards commands
 * to the user's Bridge federation API.
 */

export interface LocalConnectorManifest {
  id: string;
  title: string;
  version: string;
  /** Bridge federation verbs this connector handles */
  verbs: string[];
  readme?: string;
}

export interface LocalConnector {
  manifest: LocalConnectorManifest;
  /** Execute a federation IPC line locally (plugin-registered enqueue). */
  execute(line: string, chartbookKey?: string): Promise<{ ok: boolean; detail?: string }>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export interface ConnectorConfig {
  bridgeUrl: string;
  federationToken: string;
  resourceKind: string;
  resourceId: string;
  ownerTenantId: string;
  targetTenantId: string;
  manifest: LocalConnectorManifest;
}

/** HTTP client that registers health with the hub Bridge federation surface. */
export class FederationConnectorClient implements LocalConnector {
  constructor(private readonly cfg: ConnectorConfig) {}

  get manifest(): LocalConnectorManifest {
    return this.cfg.manifest;
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const res = await fetch(`${this.cfg.bridgeUrl}/api/federation/health`, {
      headers: { Authorization: `Bearer ${this.cfg.federationToken}` },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { ok?: boolean; sc?: { ok?: boolean } };
    return { ok: body.ok === true, detail: body.sc?.ok ? "sc_ok" : "sc_degraded" };
  }

  async execute(line: string, chartbookKey?: string): Promise<{ ok: boolean; detail?: string }> {
    const res = await fetch(`${this.cfg.bridgeUrl}/api/federation/sc/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.federationToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        line,
        chartbookKey,
        resourceKind: this.cfg.resourceKind,
        resourceId: this.cfg.resourceId,
        ownerTenantId: this.cfg.ownerTenantId,
        targetTenantId: this.cfg.targetTenantId,
      }),
    });
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { ok?: boolean; enqueued?: string };
    return { ok: body.ok === true, detail: body.enqueued };
  }
}
