import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchAccountDeletionStatus,
  requestAccountDeletion,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";

export function AccountDeletionCard() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saas, setSaas] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);
  const [deletedAt, setDeletedAt] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchAccountDeletionStatus();
        if (cancelled) return;
        setSaas(true);
        setRetentionDays(status.retentionDays);
        setDeletedAt(status.deletedAt);
      } catch {
        if (!cancelled) setSaas(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!saas && !loading) return null;

  const confirmDelete = async () => {
    if (
      !window.confirm(
        `Delete your GodMode Cloud account? Login will stop immediately. Workspace data is kept for about ${retentionDays} days, then permanently removed.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await requestAccountDeletion(reason.trim() || undefined);
      toast.success("Account scheduled for deletion. You will be signed out.");
      setDeletedAt(new Date().toISOString());
      window.setTimeout(() => {
        window.location.assign("/login");
      }, 800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          Soft-delete your Cloud account. Access ends now. Workspace data is removed after a{" "}
          {retentionDays}-day retention window (unless legal retention applies).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading…
          </div>
        ) : deletedAt ? (
          <Alert variant="destructive">
            <AlertTitle>Deletion scheduled</AlertTitle>
            <AlertDescription>
              This account is scheduled for permanent removal after the retention window.
              Contact support@godmode.software if this was a mistake.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="deletion-reason">Reason (optional)</FieldLabel>
              <Textarea
                id="deletion-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Optional note for support"
              />
            </Field>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {busy ? "Deleting…" : "Delete my Cloud account"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
