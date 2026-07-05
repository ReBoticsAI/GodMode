import { useEffect, useState } from "react";
import { Share2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  createShareGrant,
  fetchShareGrantsForResource,
  lookupUserByEmail,
  revokeShareGrant,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ShareDialogProps {
  resourceKind: string;
  resourceId: string;
  resourceLabel: string;
  trigger?: React.ReactNode;
}

type GrantRow = Record<string, unknown>;

export function ShareDialog({
  resourceKind,
  resourceId,
  resourceLabel,
  trigger,
}: ShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const res = await fetchShareGrantsForResource(resourceKind, resourceId);
    setGrants(res.grants);
  };

  useEffect(() => {
    if (open) void reload().catch(() => setGrants([]));
  }, [open, resourceKind, resourceId]);

  const share = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Enter a user email");
      return;
    }
    setBusy(true);
    try {
      const { user } = await lookupUserByEmail(trimmed);
      await createShareGrant({
        resourceKind,
        resourceId,
        granteeUserId: user.id,
        role,
      });
      toast.success(`Shared with ${user.displayName}`);
      setEmail("");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Share failed");
    } finally {
      setBusy(false);
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

  const triggerButton =
    trigger ?? (
      <Button variant="outline" size="sm">
        <Share2Icon data-icon="inline-start" />
        Share
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span
        role="presentation"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
      >
        {triggerButton}
      </span>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share {resourceLabel}</DialogTitle>
          <DialogDescription>
            Grant another user live access to this {resourceKind}. They can view or
            edit depending on role.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="share-email">User email</Label>
            <Input
              id="share-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as "viewer" | "editor")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {grants.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border">
            <ul className="divide-y text-sm">
              {grants.map((g) => (
                <li
                  key={String(g.id)}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {String(g.grantee_user_id ?? g.grantee_tenant_id ?? "unknown")}
                    </p>
                    <p className="text-xs text-muted-foreground">{String(g.role)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void revoke(String(g.id))}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => void share()} disabled={busy}>
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
