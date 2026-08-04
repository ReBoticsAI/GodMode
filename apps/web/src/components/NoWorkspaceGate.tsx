import { toast } from "sonner";
import { logoutAuth } from "@/api";
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

/**
 * Shown when the session is valid but the user has no workspace membership.
 * Admin-created accounts historically skipped provisioning (#368); this is the
 * recovery path so login never pretends to succeed with a dead session.
 */
export function NoWorkspaceGate() {
  const { user, refresh } = useTenant();

  const signOut = async () => {
    try {
      await logoutAuth();
    } catch {
      /* still clear local auth via refresh */
    }
    await refresh().catch(() => undefined);
    toast.message("Signed out");
  };

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
