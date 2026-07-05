import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  cloneSharedResource,
  createBridgeConnection,
  deleteBridgeConnection,
  acceptFederatedShareInvite,
  enableTailscaleFederation,
  fetchBridgeConnections,
  fetchNetworkPeers,
  fetchNetworkStatus,
  fetchShareGrants,
  fetchSharedModels,
  inviteNetworkPeer,
  refreshNetworkPeers,
  revokeShareGrant,
  type BridgeConnection,
  type SharedModel,
} from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type GrantRow = Record<string, unknown>;

export default function SharedPage() {
  const { user } = useTenant();
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<BridgeConnection[]>([]);
  const [sharedModels, setSharedModels] = useState<SharedModel[]>([]);
  const [remoteLabel, setRemoteLabel] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteToken, setRemoteToken] = useState("");
  const [networkStatus, setNetworkStatus] = useState<Record<string, unknown> | null>(null);
  const [peers, setPeers] = useState<Array<Record<string, unknown>>>([]);
  const [peerEmail, setPeerEmail] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [ownerBridgeUrl, setOwnerBridgeUrl] = useState("");

  const reloadNetwork = async () => {
    try {
      const [status, peerRes] = await Promise.all([
        fetchNetworkStatus(),
        fetchNetworkPeers().catch(() => ({ peers: [] })),
      ]);
      setNetworkStatus(status);
      setPeers(peerRes.peers);
    } catch {
      /* optional */
    }
  };

  const reload = async () => {
    setLoading(true);
    try {
      const [shareRes, connRes, modelRes] = await Promise.all([
        fetchShareGrants(),
        fetchBridgeConnections().catch(() => ({ connections: [] })),
        fetchSharedModels().catch(() => ({ models: [] })),
      ]);
      setGrants(shareRes.grants);
      setConnections(connRes.connections);
      setSharedModels(modelRes.models);
      await reloadNetwork();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load shares");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const registerLocal = async () => {
    try {
      await createBridgeConnection({ label: "Local connector", mode: "local" });
      toast.success("Registered local connector");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to register connection");
    }
  };

  const registerRemote = async () => {
    if (!remoteLabel.trim() || !remoteUrl.trim() || !remoteToken.trim()) {
      toast.error("Label, bridge URL and token are required");
      return;
    }
    try {
      await createBridgeConnection({
        label: remoteLabel.trim(),
        mode: "remote",
        remoteBridgeUrl: remoteUrl.trim(),
        remoteBridgeToken: remoteToken.trim(),
      });
      toast.success("Registered remote bridge connection");
      setRemoteLabel("");
      setRemoteUrl("");
      setRemoteToken("");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to register connection");
    }
  };

  const removeConnection = async (id: string) => {
    try {
      await deleteBridgeConnection(id);
      toast.success("Connection removed");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove connection");
    }
  };

  const hasLocal = connections.some((c) => c.mode === "local");

  const sharedWithMe = useMemo(
    () =>
      grants.filter(
        (g) =>
          // `model` grants get their own dedicated card below.
          g.resource_kind !== "model" &&
          (g.grantee_user_id === user?.id ||
            (g.grantee_user_id == null && g.grantee_tenant_id != null))
      ),
    [grants, user?.id]
  );

  const sharedByMe = useMemo(
    () => grants.filter((g) => g.owner_user_id === user?.id),
    [grants, user?.id]
  );

  const clone = async (kind: string, resourceId: string) => {
    try {
      const res = await cloneSharedResource(kind, resourceId);
      toast.success(`Cloned into your project (${res.newId})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Clone failed");
    }
  };

  const revoke = async (grantId: string) => {
    try {
      await revokeShareGrant(grantId);
      toast.success("Share revoked");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    }
  };

  const renderGrant = (
    g: GrantRow,
    actions: React.ReactNode
  ) => (
    <li
      key={String(g.id)}
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"
    >
      <div className="min-w-0">
        <p className="font-medium">
          {String(g.resource_kind)} · {String(g.resource_id)}
        </p>
        <p className="text-xs text-muted-foreground">
          Role: {String(g.role)} · {String(g.created_at ?? "")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline">{String(g.role)}</Badge>
        {actions}
      </div>
    </li>
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shared</h1>
        <p className="text-sm text-muted-foreground">
          Resources shared with you and resources you have shared with others.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Network (Tailscale)</CardTitle>
              <CardDescription>
                Connect home Bridges over your tailnet for cross-instance sharing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {networkStatus ? (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    Tailscale:{" "}
                    {(networkStatus.tailscale as { running?: boolean })?.running
                      ? "connected"
                      : "not connected"}
                  </p>
                  {typeof networkStatus.suggestedFederationUrl === "string" ? (
                    <p>
                      Federation URL:{" "}
                      <code className="text-xs">{networkStatus.suggestedFederationUrl}</code>
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void enableTailscaleFederation().then(reloadNetwork)}>
                  Enable Tailscale URL
                </Button>
                <Button size="sm" variant="outline" onClick={() => void refreshNetworkPeers().then((r) => setPeers(r.peers))}>
                  Refresh peers
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  placeholder="Teammate email for Tailscale invite"
                  value={peerEmail}
                  onChange={(e) => setPeerEmail(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    void inviteNetworkPeer(peerEmail.trim())
                      .then(() => {
                        toast.success("Invite sent");
                        setPeerEmail("");
                        return reloadNetwork();
                      })
                      .catch((err) =>
                        toast.error(err instanceof Error ? err.message : "Invite failed")
                      );
                  }}
                >
                  Invite
                </Button>
              </div>
              {peers.length > 0 ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {peers.map((p) => (
                    <li key={String(p.id)} className="flex items-center gap-2">
                      <Badge variant="outline">{String(p.status ?? "pending")}</Badge>
                      <span>{String(p.remote_email ?? p.remote_bridge_url ?? p.id)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No peer connections yet.</p>
              )}
              <div className="border-t pt-4 space-y-2">
                <p className="text-sm font-medium">Accept federated share invite</p>
                <Input
                  placeholder="Owner bridge URL (http://host:3847)"
                  value={ownerBridgeUrl}
                  onChange={(e) => setOwnerBridgeUrl(e.target.value)}
                />
                <Input
                  placeholder="Invite token from share link"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    void acceptFederatedShareInvite(inviteToken.trim(), ownerBridgeUrl.trim())
                      .then(() => {
                        toast.success("Share invite accepted");
                        setInviteToken("");
                        return reload();
                      })
                      .catch((err) =>
                        toast.error(err instanceof Error ? err.message : "Accept failed")
                      );
                  }}
                >
                  Accept invite
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shared with me</CardTitle>
              <CardDescription>
                Live access to another user&apos;s project resources
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sharedWithMe.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing shared with you yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {sharedWithMe.map((g) =>
                    renderGrant(
                      g,
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void clone(String(g.resource_kind), String(g.resource_id))
                        }
                      >
                        Clone to my project
                      </Button>
                    )
                  )}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Models shared with me</CardTitle>
              <CardDescription>
                Local models friends shared for free inference. Point an agent&apos;s
                backend at one (Remote inference) to use it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sharedModels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No models shared with you yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {sharedModels.map((m) => (
                    <li
                      key={m.endpointId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{m.baseModelName}</p>
                        <p className="text-xs text-muted-foreground">
                          from {m.ownerDisplayName} · endpoint{" "}
                          <code className="font-mono">{m.endpointId.slice(0, 8)}</code>
                        </p>
                      </div>
                      <Badge variant="outline">free</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shared by me</CardTitle>
              <CardDescription>Resources you have granted to others</CardDescription>
            </CardHeader>
            <CardContent>
              {sharedByMe.length === 0 ? (
                <p className="text-sm text-muted-foreground">You haven&apos;t shared anything yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {sharedByMe.map((g) =>
                    renderGrant(
                      g,
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void revoke(String(g.id))}
                      >
                        Revoke
                      </Button>
                    )
                  )}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bridge connections</CardTitle>
              <CardDescription>
                Connect this workspace to a local connector or a remote peer bridge for
                hardware-bound marketplace plugins.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {connections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No connections registered yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {connections.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{c.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.mode === "remote"
                            ? c.remote_bridge_url
                            : "This Bridge's local connector"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{c.mode}</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void removeConnection(c.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {!hasLocal && (
                <Button size="sm" variant="outline" onClick={() => void registerLocal()}>
                  Register local connector
                </Button>
              )}

              <div className="flex flex-col gap-2 rounded-md border p-3">
                <p className="text-sm font-medium">Add remote bridge</p>
                <Input
                  placeholder="Label (e.g. My Bridge)"
                  value={remoteLabel}
                  onChange={(e) => setRemoteLabel(e.target.value)}
                />
                <Input
                  placeholder="Bridge URL (e.g. http://172.16.1.94:3847)"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                />
                <Input
                  placeholder="Federation token"
                  value={remoteToken}
                  onChange={(e) => setRemoteToken(e.target.value)}
                />
                <Button size="sm" onClick={() => void registerRemote()}>
                  Add remote connection
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
