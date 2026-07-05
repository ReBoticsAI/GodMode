import { useCallback, useEffect, useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  createAdminTenantForUser,
  createAdminUser,
  deleteAdminTenant,
  deleteAdminUser,
  fetchUsers,
  updateAdminTenant,
  updateAdminUser,
  type AdminUserRow,
  type TenantSummary,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useTenant } from "@/lib/tenant-context";

type UserDialogMode = { kind: "create" } | { kind: "edit"; user: AdminUserRow };

type TenantDialogState =
  | { kind: "create"; userId: string }
  | { kind: "edit"; userId: string; tenant: TenantSummary };

export function AdminUsersPanel() {
  const { user: sessionUser } = useTenant();
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [userDialog, setUserDialog] = useState<UserDialogMode | null>(null);
  const [tenantDialog, setTenantDialog] = useState<TenantDialogState | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    return fetchUsers()
      .then((r) => setUsers(r.users))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to load users")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDeleteUser = async (u: AdminUserRow) => {
    if (u.id === sessionUser?.id) {
      toast.error("You cannot delete your own account");
      return;
    }
    if (
      !window.confirm(
        `Delete user "${u.displayName}" (${u.email})? This removes their workspaces and cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await deleteAdminUser(u.id);
      toast.success("User deleted");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleDeleteTenant = async (tenant: TenantSummary) => {
    if (tenant.is_operator === 1) {
      toast.error("The operator tenant cannot be deleted");
      return;
    }
    if (
      !window.confirm(
        `Delete workspace "${tenant.name}"? All data in this project will be permanently removed.`
      )
    ) {
      return;
    }
    try {
      await deleteAdminTenant(tenant.id);
      toast.success("Workspace deleted");
      await reload();
      setUserDialog((prev) => {
        if (prev?.kind !== "edit") return prev;
        return {
          kind: "edit",
          user: {
            ...prev.user,
            tenants: prev.user.tenants.filter((t) => t.id !== tenant.id),
          },
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Users & workspaces</CardTitle>
          <CardDescription>
            Create accounts, reset passwords, grant admin access, and manage
            personal workspaces.
          </CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => setUserDialog({ kind: "create" })}>
              <PlusIcon className="size-4" />
              Add user
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading users…</p>
          ) : users && users.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.displayName}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      {u.isAdmin ? (
                        <Badge variant="secondary">Admin</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.tenants.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          u.tenants.map((t) => (
                            <Badge
                              key={t.id}
                              variant={t.is_operator === 1 ? "outline" : "secondary"}
                              className="text-[10px]"
                            >
                              {t.name}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${u.displayName}`}
                          onClick={() => setUserDialog({ kind: "edit", user: u })}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${u.displayName}`}
                          disabled={u.id === sessionUser?.id}
                          onClick={() => void handleDeleteUser(u)}
                        >
                          <Trash2Icon className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No users found.</p>
          )}
        </CardContent>
      </Card>

      <UserDialog
        mode={userDialog}
        onClose={() => setUserDialog(null)}
        onSaved={async (saved) => {
          await reload();
          if (userDialog?.kind === "edit") {
            setUserDialog({ kind: "edit", user: saved });
          } else {
            setUserDialog(null);
          }
        }}
        onAddTenant={(userId) => setTenantDialog({ kind: "create", userId })}
        onEditTenant={(userId, tenant) =>
          setTenantDialog({ kind: "edit", userId, tenant })
        }
        onDeleteTenant={(tenant) => void handleDeleteTenant(tenant)}
      />

      <TenantDialog
        state={tenantDialog}
        onClose={() => setTenantDialog(null)}
        onSaved={async (user) => {
          await reload();
          setTenantDialog(null);
          setUserDialog({ kind: "edit", user });
        }}
      />
    </>
  );
}

function UserDialog({
  mode,
  onClose,
  onSaved,
  onAddTenant,
  onEditTenant,
  onDeleteTenant,
}: {
  mode: UserDialogMode | null;
  onClose: () => void;
  onSaved: (user: AdminUserRow) => Promise<void>;
  onAddTenant: (userId: string) => void;
  onEditTenant: (userId: string, tenant: TenantSummary) => void;
  onDeleteTenant: (tenant: TenantSummary) => void;
}) {
  const isCreate = mode?.kind === "create";
  const user = mode?.kind === "edit" ? mode.user : null;

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [provisionDefaultTenant, setProvisionDefaultTenant] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!mode) return;
    if (mode.kind === "create") {
      setEmail("");
      setDisplayName("");
      setPassword("");
      setIsAdmin(false);
      setProvisionDefaultTenant(true);
    } else {
      setEmail(mode.user.email);
      setDisplayName(mode.user.displayName);
      setPassword("");
      setIsAdmin(mode.user.isAdmin);
    }
  }, [mode]);

  const submit = async () => {
    setSaving(true);
    try {
      if (isCreate) {
        const res = await createAdminUser({
          email,
          password,
          displayName: displayName || undefined,
          isAdmin,
          provisionDefaultTenant,
        });
        toast.success("User created");
        await onSaved(res.user);
        onClose();
      } else if (user) {
        const res = await updateAdminUser(user.id, {
          email,
          displayName,
          isAdmin,
          password: password || undefined,
        });
        toast.success("User updated");
        await onSaved(res.user);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>{isCreate ? "Add user" : "Edit user"}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? "Create a login and optionally provision a default personal workspace."
              : "Update account details or reset the password."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-user-email">Email</Label>
            <Input
              id="admin-user-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-user-name">Display name</Label>
            <Input
              id="admin-user-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-user-password">
              {isCreate ? "Password" : "New password (optional)"}
            </Label>
            <Input
              id="admin-user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isAdmin}
              onCheckedChange={(checked) => setIsAdmin(!!checked)}
            />
            Platform admin
          </label>
          {isCreate && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={provisionDefaultTenant}
                onCheckedChange={(checked) => setProvisionDefaultTenant(!!checked)}
              />
              Create default personal workspace
            </label>
          )}

          {user && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Workspaces</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onAddTenant(user.id)}
                >
                  <PlusIcon className="size-3.5" />
                  Add workspace
                </Button>
              </div>
              {user.tenants.length === 0 ? (
                <p className="text-sm text-muted-foreground">No workspaces.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {user.tenants.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{t.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t.slug}
                          {t.is_operator === 1 ? " · operator" : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${t.name}`}
                        onClick={() => onEditTenant(user.id, t)}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${t.name}`}
                        disabled={t.is_operator === 1}
                        onClick={() => onDeleteTenant(t)}
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !email.trim() || (isCreate && password.length < 6)}
          >
            {saving ? <Spinner className="size-4" /> : isCreate ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TenantDialog({
  state,
  onClose,
  onSaved,
}: {
  state: TenantDialogState | null;
  onClose: () => void;
  onSaved: (user: AdminUserRow) => Promise<void>;
}) {
  const isCreate = state?.kind === "create";
  const tenant = state?.kind === "edit" ? state.tenant : null;
  const userId = state?.userId ?? "";

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!state) return;
    if (state.kind === "create") {
      setName("");
      setSlug("");
    } else {
      setName(state.tenant.name);
      setSlug(state.tenant.slug);
    }
  }, [state]);

  const submit = async () => {
    if (!state) return;
    setSaving(true);
    try {
      if (isCreate) {
        const res = await createAdminTenantForUser(
          userId,
          name,
          slug.trim() || undefined
        );
        toast.success("Workspace created");
        await onSaved(res.user);
      } else if (tenant) {
        await updateAdminTenant(tenant.id, {
          name,
          slug: tenant.is_operator === 1 ? undefined : slug,
        });
        toast.success("Workspace updated");
        const users = await fetchUsers();
        const user = users.users.find((u) => u.id === userId);
        if (user) await onSaved(user);
        else onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>{isCreate ? "Add workspace" : "Edit workspace"}</DialogTitle>
          <DialogDescription>
            Personal workspaces are isolated projects with their own Intelligence
            data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-tenant-name">Name</Label>
            <Input
              id="admin-tenant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-tenant-slug">Slug</Label>
            <Input
              id="admin-tenant-slug"
              value={slug}
              disabled={tenant?.is_operator === 1}
              onChange={(e) => setSlug(e.target.value)}
            />
            {tenant?.is_operator === 1 && (
              <p className="text-xs text-muted-foreground">
                Operator tenant slug cannot be changed.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !name.trim()}
          >
            {saving ? <Spinner className="size-4" /> : isCreate ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
