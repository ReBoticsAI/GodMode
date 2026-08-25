import { useEffect, useRef, useState } from "react";
import { CheckIcon, ExternalLinkIcon, Link2Icon, UnlinkIcon } from "lucide-react";
import { toast } from "sonner";
import {
  approveCloudSellerLink,
  denyCloudSellerLink,
  fetchSellerLinkStatus,
  pollSellerLink,
  startSellerLink,
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
  marketplaceCloudVaultMarketplaceUrl,
  marketplaceCloudVaultUrl,
  userFacingErrorMessage,
} from "@/lib/marketplace-format";

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
    tosAccepted: false,
    stripePayoutReady: false,
  };
}

/** Local Sell: start device-code link to GodMode Cloud Seller account. */
export function LocalSellerLinkCard({
  onStatusChange,
}: {
  onStatusChange?: (status: SellerLinkStatus) => void;
} = {}) {
  const [status, setStatus] = useState<SellerLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyStatus = (next: SellerLinkStatus) => {
    setStatus(next);
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

  const onStart = async () => {
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
      toast.error(userFacingErrorMessage(err, "Could not start Seller link"));
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
          Link this Local install to a Cloud Seller seat (~$4.99/mo). Sell checklist below
          reads entitlement and commerce readiness from Cloud.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status?.linked ? (
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
          <Button type="button" onClick={() => void onStart()} disabled={busy}>
            {busy ? "Starting…" : "Connect GodMode Seller account"}
          </Button>
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

/** Local Sell: Cloud readiness checklist; commerce stays on Cloud Sell. */
export function LocalSellChecklistCard({
  status,
  onRefresh,
}: {
  status: SellerLinkStatus | null;
  onRefresh?: () => void;
}) {
  const signals = status ?? emptySellerLinkStatus();
  const complete = localSellChecklistComplete(signals);
  const seatReady = localSellSeatReady(signals);
  const sellUrl = marketplaceCloudSellUrl();
  const vaultUrl = marketplaceCloudVaultUrl();
  const vaultMarketplaceUrl = marketplaceCloudVaultMarketplaceUrl();

  const rows: ChecklistRow[] = [
    {
      id: "seat",
      label: "Cloud Seller seat linked and active",
      done: seatReady,
      href: sellUrl,
      cta: signals.linked ? "Open Cloud Sell" : "Connect on Cloud Sell",
    },
    {
      id: "github",
      label: "GitHub connected",
      done: Boolean(signals.githubConnected),
      href: vaultUrl,
      cta: "Open Cloud Vault",
    },
    {
      id: "stripe",
      label: "Stripe Connect payouts ready",
      done: Boolean(signals.stripePayoutReady),
      href: vaultMarketplaceUrl,
      cta: "Open Cloud Vault Marketplace",
    },
    {
      id: "tos",
      label: "Marketplace Terms accepted",
      done: Boolean(signals.tosAccepted),
      href: sellUrl,
      cta: "Accept on Cloud Sell",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sell readiness checklist</CardTitle>
        <CardDescription>
          Complete these on GodMode Cloud. Local does not publish or take payouts as
          merchant of record.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
              {row.done ? null : (
                <a
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  href={row.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  {row.cta}
                </a>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {onRefresh ? (
            <Button type="button" variant="outline" onClick={() => onRefresh()}>
              Refresh checklist
            </Button>
          ) : null}
          {complete ? (
            <a className={cn(buttonVariants())} href={sellUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              Continue on Cloud Sell
            </a>
          ) : null}
        </div>
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
