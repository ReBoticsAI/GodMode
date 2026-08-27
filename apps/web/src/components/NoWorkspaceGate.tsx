import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { fetchSellerEntitlement, logoutAuth } from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { APP_NAME } from "@/lib/navigation";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { readSellerLinkResumePath } from "@/lib/seller-link-resume";

/**
 * Shown when the session is valid but the user has no workspace membership.
 * Admin-created accounts historically skipped provisioning (#368); this is the
 * recovery path so login never pretends to succeed with a dead session.
 *
 * Seller-only Cloud accounts (complimentary Seller seat, no workspace) get a
 * commerce-focused path back to Local Sell instead of workspace provisioning.
 */
export function NoWorkspaceGate() {
  const { user, refresh } = useTenant();
  const navigate = useNavigate();
  const [sellerActive, setSellerActive] = useState<boolean | null>(null);
  const sellerResume = readSellerLinkResumePath();

  useEffect(() => {
    void fetchSellerEntitlement()
      .then((ent) => setSellerActive(Boolean(ent.sellerActive)))
      .catch(() => setSellerActive(false));
  }, []);

  const signOut = async () => {
    try {
      await logoutAuth();
    } catch {
      /* still clear local auth via refresh */
    }
    await refresh().catch(() => undefined);
    toast.message("Signed out");
  };

  const continueSellerSetup = () => {
    if (sellerResume) {
      navigate(sellerResume, { replace: true });
      return;
    }
    toast.message(
      "Open Local GodMode → Marketplace → Sell and start Connect GitHub or Connect Stripe again."
    );
  };

  if (sellerActive === true) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{APP_NAME} Seller account</CardTitle>
            <CardDescription>
              Signed in as {user?.email ?? "your account"}. This is a Seller-only
              Cloud account for Local Sell (GitHub, Stripe, payouts). You do not
              need a Cloud workspace for that flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {sellerResume ? (
              <Button type="button" className="w-full" onClick={continueSellerSetup}>
                Continue Local Sell setup
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Return to Local GodMode, open Marketplace → Sell, and use Connect
                GitHub or Connect Stripe on Seller account. That opens the right
                Cloud page and sends you back to Local when finished.
              </p>
            )}
            <Button type="button" variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{APP_NAME}</CardTitle>
          <CardDescription>
            Signed in as {user?.email ?? "your account"}, but you do not have a
            workspace yet. Create one to continue, or ask a platform admin to
            add a workspace for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CreateWorkspaceDialog
            trigger={
              <Button className="w-full">Create workspace</Button>
            }
          />
          <Button type="button" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
