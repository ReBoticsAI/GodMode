import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckIcon, ExternalLinkIcon, Link2Icon, UnlinkIcon } from "lucide-react";
import { toast } from "sonner";
import {
  approveCloudSellerLink,
  denyCloudSellerLink,
  fetchSellerLinkStatus,
  pollSellerLink,
  startSellerLink,
  startSellerLinkRedirect,
  unlinkSellerLink,
  type SellerLinkStatus,
} from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  localSellChecklistComplete,
  localSellSeatReady,
  marketplaceCloudSellUrl,
  userFacingErrorMessage,
  type LocalSellChecklistSignals,
} from "@/lib/marketplace-format";
import { MARKETPLACE_PATH, VAULT_PATH } from "@/lib/navigation";

type PendingLink = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalMs: number;
};

function emptySellerLinkStatus(): SellerLinkStatus {
  return {
    linked: false,
    sellerActive: false,
    planId: null,
    source: null,
    cloudUserHint: null,
    linkedAt: null,
    githubConnected: false,
    githubLogin: null,
    tosAccepted: false,
    stripePayoutReady: false,
  };
}

/** Local Sell: primary Cloud redirect bind; device-code is secondary. */
export function LocalSellerLinkCard({
  status: statusFromParent,
  onStatusChange,
}: {
  status?: SellerLinkStatus | null;
  onStatusChange?: (status: SellerLinkStatus) => void;
} = {}) {
  const [statusLocal, setStatusLocal] = useState<SellerLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [showDeviceCode, setShowDeviceCode] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const status = statusFromParent !== undefined ? statusFromParent : statusLocal;

  const applyStatus = (next: SellerLinkStatus) => {
    setStatusLocal(next);
    onStatusChange?.(next);
  };

  const reload = async () => {
    try {
      applyStatus(await fetchSellerLinkStatus());
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Could not load Seller link status"));
    }
  };

  useEffect(() => {
    void reload();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const result = await pollSellerLink(pending.deviceCode);
          if (result.status === "complete") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPending(null);
            await reload();
            toast.success("GodMode Cloud Seller account linked");
            return;
          }
          if (result.status === "expired" || result.status === "denied") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPending(null);
            toast.error(
              result.status === "denied"
                ? "Seller link was denied on Cloud"
                : "Seller link code expired. Start again."
            );
          }
        } catch (err) {
          toast.error(userFacingErrorMessage(err, "Seller link poll failed"));
        }
      })();
    }, pending.intervalMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pending]);

  const onStartRedirect = async () => {
    setBusy(true);
    try {
      const returnUrl = `${window.location.origin}${MARKETPLACE_PATH}?tab=seller`;
      const started = await startSellerLinkRedirect(returnUrl);
      if (!started.connectUrl) {
        throw new Error("Cloud did not return a connect URL");
      }
      window.location.href = started.connectUrl;
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Could not start Seller link"));
      setBusy(false);
    }
  };

  const onStartDevice = async () => {
    setBusy(true);
    try {
      const started = await startSellerLink();
      setPending({
        deviceCode: started.deviceCode,
        userCode: started.userCode,
        verificationUrl: started.verificationUrl,
        intervalMs: Math.max(3, started.interval || 5) * 1000,
      });
      toast.message("Approve this code on GodMode Cloud while signed in.");
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Could not start Seller link code"));
    } finally {
      setBusy(false);
    }
  };

  const onUnlink = async () => {
    setBusy(true);
    try {
      await unlinkSellerLink();
      applyStatus(emptySellerLinkStatus());
      setPending(null);
      toast.success("Seller account unlinked");
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Unlink failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2Icon className="size-4" />
          GodMode Cloud Seller account
        </CardTitle>
        <CardDescription>
          Sign in or buy a GodMode Seller seat on Cloud, then return here. Local Sell tools unlock
          when the checklist below is complete.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === null ? (
          <p className="text-sm text-muted-foreground">Loading Seller link status…</p>
        ) : status.linked ? (
          <>
            <p className="text-sm">
              Linked{status.cloudUserHint ? ` as ${status.cloudUserHint}` : ""}.
              {status.sellerActive
                ? " Seller commerce is active."
                : " Seller seat is not active yet. Buy or renew the Seller plan on Cloud."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void reload()} disabled={busy}>
                Refresh status
              </Button>
              <Button type="button" variant="outline" onClick={() => void onUnlink()} disabled={busy}>
                <UnlinkIcon data-icon="inline-start" />
                Unlink
              </Button>
            </div>
          </>
        ) : pending ? (
          <>
            <Alert>
              <AlertTitle>Approve on Cloud</AlertTitle>
              <AlertDescription>
                Enter code{" "}
                <span className="font-mono text-foreground">{pending.userCode}</span> on
                GodMode Cloud, or open the verification link while signed in.
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <a
                className={cn(buttonVariants())}
                href={pending.verificationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Cloud approve
              </a>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (pollRef.current) clearInterval(pollRef.current);
                  setPending(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button type="button" onClick={() => void onStartRedirect()} disabled={busy}>
              {busy ? "Opening Cloud…" : "Connect GodMode Seller account"}
            </Button>
            {showDeviceCode ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void onStartDevice()}
                disabled={busy}
              >
                Use a link code instead
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit text-muted-foreground"
                onClick={() => setShowDeviceCode(true)}
              >
                Having trouble? Use a link code
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type ChecklistRow = {
  id: string;
  label: string;
  done: boolean;
  href: string;
  cta: string;
};

/** Local Sell: readiness checklist; unlocks Local seller dashboard when complete. */
export function LocalSellChecklistCard({
  signals,
  onRefresh,
  onOpenTos,
  onConnectGithub,
  onConnectStripe,
}: {
  signals: LocalSellChecklistSignals;
  onRefresh?: () => void;
  onOpenTos?: () => void;
  /** Local → Cloud Seller GitHub App connect (#711). */
  onConnectGithub?: () => void;
  /** Local → Cloud Seller Stripe Connect (#709). */
  onConnectStripe?: () => void;
}) {
  const complete = localSellChecklistComplete(signals);
  const seatReady = localSellSeatReady(signals);
  const sellUrl = marketplaceCloudSellUrl();
  const vaultMarketplace = `${VAULT_PATH}?tab=marketplace`;

  const rows: ChecklistRow[] = [
    {
      id: "seat",
      label: "GodMode Seller seat linked and active",
      done: seatReady,
      href: sellUrl,
      cta: signals.linked ? "Renew on Cloud" : "Buy seat on Cloud",
    },
    {
      id: "github",
      label: "GitHub connected",
      done: Boolean(signals.githubConnected),
      href: "",
      cta: "Connect GitHub on Seller account",
    },
    {
      id: "stripe",
      label: "Stripe Connect payouts ready",
      done: Boolean(signals.stripePayoutReady),
      href: vaultMarketplace,
      cta: "Connect Stripe on Seller account",
    },
    {
      id: "tos",
      label: "Marketplace Terms accepted",
      done: Boolean(signals.tosAccepted),
      href: "",
      cta: "Accept Marketplace ToS",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sell readiness checklist</CardTitle>
        <CardDescription>
          {complete
            ? "Checklist complete. Seller tools are unlocked below."
            : "Complete each item to unlock Local Sell: Terms, payouts, catalog submit, Publish, and My listings."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {complete ? (
          <Alert>
            <AlertTitle>Local Sell unlocked</AlertTitle>
            <AlertDescription>
              You can publish and manage Community listings on this install. Buyers still checkout
              on GodMode Cloud; delivery installs here.
            </AlertDescription>
          </Alert>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {row.done ? (
                    <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <span
                      className="size-4 shrink-0 rounded-full border border-muted-foreground/40"
                      aria-hidden
                    />
                  )}
                  <span className="font-medium">{row.label}</span>
                  <Badge variant={row.done ? "secondary" : "outline"}>
                    {row.done ? "Ready" : "Needed"}
                  </Badge>
                </div>
                {row.done ? null : row.id === "seat" ? (
                  <a
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    href={row.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    {row.cta}
                  </a>
                ) : row.id === "github" && onConnectGithub ? (
                  <Button type="button" size="sm" variant="outline" onClick={onConnectGithub}>
                    <ExternalLinkIcon data-icon="inline-start" />
                    {row.cta}
                  </Button>
                ) : row.id === "stripe" && onConnectStripe ? (
                  <Button type="button" size="sm" variant="outline" onClick={onConnectStripe}>
                    <ExternalLinkIcon data-icon="inline-start" />
                    {row.cta}
                  </Button>
                ) : row.id === "tos" && onOpenTos ? (
                  <Button type="button" size="sm" variant="outline" onClick={onOpenTos}>
                    {row.cta}
                  </Button>
                ) : (
                  <Link
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    to={row.href}
                  >
                    {row.cta}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {onRefresh ? (
          <Button type="button" variant="outline" onClick={() => onRefresh()}>
            Refresh checklist
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Cloud Sell: approve a Local device-code from `?seller_link=CODE`. */
export function CloudSellerLinkApproveCard({
  initialCode,
  onCleared,
}: {
  initialCode: string;
  onCleared: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCode(initialCode);
  }, [initialCode]);

  const onApprove = async () => {
    setBusy(true);
    try {
      await approveCloudSellerLink(code);
      toast.success("Local Seller link approved. Return to Local Marketplace.");
      onCleared();
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Approve failed"));
    } finally {
      setBusy(false);
    }
  };

  const onDeny = async () => {
    setBusy(true);
    try {
      await denyCloudSellerLink(code);
      toast.message("Seller link denied");
      onCleared();
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Deny failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Approve Local Seller link</CardTitle>
        <CardDescription>
          A Self-Hosted GodMode asked to link this Cloud Seller account. Confirm the code matches
          what Local shows.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="seller-link-code">Link code</FieldLabel>
          <Input
            id="seller-link-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="font-mono"
            autoComplete="off"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void onApprove()} disabled={busy || !code.trim()}>
            {busy ? "Working…" : "Approve link"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void onDeny()}
            disabled={busy || !code.trim()}
          >
            Deny
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
