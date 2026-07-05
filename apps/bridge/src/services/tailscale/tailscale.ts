import { execSync } from "node:child_process";
import fs from "node:fs";
import { config } from "../../config.js";

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  self?: {
    id: string;
    dnsName: string;
    tailscaleIps: string[];
    online: boolean;
  };
  peers: Array<{
    id: string;
    dnsName: string;
    tailscaleIps: string[];
    online: boolean;
    user?: string;
  }>;
  error?: string;
}

function runTailscale(args: string): string {
  return execSync(`tailscale ${args}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

export function isTailscaleInstalled(): boolean {
  try {
    if (process.platform === "win32") {
      execSync("where tailscale", { stdio: "pipe" });
    } else {
      execSync("which tailscale", { stdio: "pipe" });
    }
    return true;
  } catch {
    return false;
  }
}

export function getTailscaleStatus(): TailscaleStatus {
  if (!isTailscaleInstalled()) {
    return { installed: false, running: false, peers: [], error: "Tailscale CLI not found" };
  }
  try {
    const raw = runTailscale("status --json");
    const data = JSON.parse(raw) as {
      Self?: {
        ID?: string;
        DNSName?: string;
        TailscaleIPs?: string[];
        Online?: boolean;
      };
      Peer?: Record<
        string,
        {
          ID?: string;
          DNSName?: string;
          TailscaleIPs?: string[];
          Online?: boolean;
          UserID?: number;
        }
      >;
    };
    const self = data.Self;
    const peers = Object.values(data.Peer ?? {}).map((p) => ({
      id: p.ID ?? "",
      dnsName: (p.DNSName ?? "").replace(/\.$/, ""),
      tailscaleIps: p.TailscaleIPs ?? [],
      online: Boolean(p.Online),
      user: p.UserID != null ? String(p.UserID) : undefined,
    }));
    return {
      installed: true,
      running: Boolean(self),
      self: self
        ? {
            id: self.ID ?? "",
            dnsName: (self.DNSName ?? "").replace(/\.$/, ""),
            tailscaleIps: self.TailscaleIPs ?? [],
            online: Boolean(self.Online),
          }
        : undefined,
      peers,
    };
  } catch (err) {
    return {
      installed: true,
      running: false,
      peers: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function suggestFederationPublicUrl(): string | null {
  const status = getTailscaleStatus();
  if (!status.self?.dnsName) return null;
  const host = status.self.dnsName || status.self.tailscaleIps[0];
  if (!host) return null;
  const port = config.port;
  return `http://${host}:${port}`;
}

export function inviteTailscaleUser(email: string): { ok: boolean; detail?: string } {
  if (!isTailscaleInstalled()) {
    return { ok: false, detail: "Tailscale not installed" };
  }
  try {
    const out = runTailscale(`invite --email ${JSON.stringify(email)}`);
    return { ok: true, detail: out };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function probeFederationHealth(url: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/federation/health`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function writeFederationUrlHint(url: string): void {
  const hintPath = `${config.dataDir}/federation-public-url.txt`;
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(hintPath, url, "utf8");
}
