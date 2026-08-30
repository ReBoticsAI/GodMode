import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAdminSaasCustomers,
  setAdminSaasComplimentaryAccess,
  setAdminSaasCustomerAccess,
  softDeleteAdminSaasCustomer,
  type AdminSaasCustomerRow,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

function formatWhen(iso: string | null): string {
  if (!iso) return "n/a";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

function formatOwnedWorkspaces(
  workspaces: Array<{ id: string; name: string }>
): string | null {
  if (workspaces.length === 0) return null;
  if (workspaces.length === 1) return workspaces[0]!.name;
  return `${workspaces.length} workspaces: ${workspaces.map((w) => w.name).join(", ")}`;
}

export function AdminSaasCustomersPanel() {
  const [rows, setRows] = useState<AdminSaasCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetchAdminSaasCustomers()
      .then((r) => setRows(r.customers))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to load customers")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggleAccess = async (row: AdminSaasCustomerRow) => {
    if (!row.userId) {
      toast.error("This checkout has not created an account yet");
      return;
    }
    const disabling = !row.accessDisabled;
    let reason: string | null = null;
    if (disabling) {
      const entered = window.prompt(
        "Suspend reason (shown to the user on login). Leave blank for a generic message.",
        row.accessDisabledReason ?? ""
      );
      if (entered === null) return;
      reason = entered.trim() || null;
    }
    setBusyUserId(row.userId);
    try {
      await setAdminSaasCustomerAccess(row.userId, disabling, reason);
      toast.success(disabling ? "Account suspended" : "Access restored");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyUserId(null);
    }
  };

  const softDelete = async (row: AdminSaasCustomerRow) => {
    if (!row.userId) {
      toast.error("This checkout has not created an account yet");
      return;
    }
    if (
      !window.confirm(
        `Soft-delete ${row.email ?? row.displayName ?? "this user"}? Login stops now; data is wiped after retention.`
      )
    ) {
      return;
    }
    setBusyUserId(row.userId);
    try {
      await softDeleteAdminSaasCustomer(row.userId);
      toast.success("Account soft-deleted");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Soft-delete failed");
    } finally {
      setBusyUserId(null);
    }
  };

  const toggleComplimentary = async (
    row: AdminSaasCustomerRow,
    kind: "workspace" | "seller"
  ) => {
    if (!row.userId) {
      toast.error("This checkout has not created an account yet");
      return;
    }
    const active =
      kind === "seller" ? row.complimentarySellerAccess : row.complimentaryAccess;
    const grant = !active;
    if (
      !grant &&
      !window.confirm(
        kind === "seller"
          ? `Revoke complimentary Seller access for ${row.email ?? row.displayName ?? "this user"}?`
          : `Revoke complimentary Cloud access for ${row.email ?? row.displayName ?? "this user"}? They will need to subscribe before logging in again.`
      )
    ) {
      return;
    }
    setBusyUserId(row.userId);
    try {
      await setAdminSaasComplimentaryAccess(row.userId, grant, { kind });
      toast.success(
        grant
          ? kind === "seller"
            ? "Complimentary Seller access granted"
            : "Complimentary Cloud access granted"
          : kind === "seller"
            ? "Complimentary Seller access revoked"
            : "Complimentary access revoked. They must subscribe to continue."
      );
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>SaaS customers</CardTitle>
        <CardDescription>
          Paid and complimentary GodMode Cloud and Seller accounts, subscription
          status, and access controls. Complimentary access is separate from
          platform admin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading customers…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No SaaS customers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Plan</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Last seen</th>
                  <th className="py-2 pr-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const workspaceLabel = formatOwnedWorkspaces(row.ownedWorkspaces);
                  return (
                  <tr
                    key={`${row.userId ?? row.email ?? "row"}-${idx}`}
                    className="border-b border-border/60 align-top"
                  >
                    <td className="py-3 pr-3">
                      <div className="font-medium">
                        {row.displayName ?? row.email ?? "Pending signup"}
                      </div>
                      <div className="text-muted-foreground">{row.email ?? "n/a"}</div>
                      {workspaceLabel ? (
                        <div className="text-xs text-muted-foreground">
                          {workspaceLabel}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3">
                      {row.planLabel ?? row.planId ?? "n/a"}
                      {row.amountLabel ? (
                        <div className="text-xs text-muted-foreground">
                          {row.amountLabel}
                        </div>
                      ) : null}
                      {row.currentPeriodEnd ? (
                        <div className="text-xs text-muted-foreground">
                          Period end {formatWhen(row.currentPeriodEnd)}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {row.status ? (
                          <Badge variant="secondary">
                            {row.status.replace(/_/g, " ")}
                          </Badge>
                        ) : null}
                        {row.complimentaryAccess ? (
                          <Badge variant="outline">complimentary Cloud</Badge>
                        ) : null}
                        {row.complimentarySellerAccess ? (
                          <Badge variant="outline">complimentary Seller</Badge>
                        ) : null}
                        {row.accessDisabled ? (
                          <Badge variant="destructive">suspended</Badge>
                        ) : null}
                        {row.deletionStatus === "pending_wipe" ? (
                          <Badge variant="destructive">pending wipe</Badge>
                        ) : null}
                        {row.accessRevoked ? (
                          <Badge variant="outline">billing revoked</Badge>
                        ) : null}
                        {row.cancelAtPeriodEnd ? (
                          <Badge variant="outline">cancels EOP</Badge>
                        ) : null}
                        {row.isAdmin ? <Badge>admin</Badge> : null}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      {formatWhen(row.lastSeenAt)}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-col items-start gap-2">
                        {row.stripeDashboardUrl ? (
                          <a
                            href={row.stripeDashboardUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                          >
                            Stripe
                            <ExternalLinkIcon className="size-3.5 opacity-70" />
                          </a>
                        ) : null}
                        {row.userId && !row.isAdmin ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyUserId === row.userId}
                              onClick={() => void toggleComplimentary(row, "workspace")}
                            >
                              {busyUserId === row.userId ? (
                                <Spinner className="size-3.5" />
                              ) : row.complimentaryAccess ? (
                                "Revoke Cloud complimentary"
                              ) : (
                                "Grant Cloud complimentary"
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyUserId === row.userId}
                              onClick={() => void toggleComplimentary(row, "seller")}
                            >
                              {busyUserId === row.userId ? (
                                <Spinner className="size-3.5" />
                              ) : row.complimentarySellerAccess ? (
                                "Revoke Seller complimentary"
                              ) : (
                                "Grant Seller complimentary"
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyUserId === row.userId}
                              onClick={() => void toggleAccess(row)}
                            >
                              {busyUserId === row.userId ? (
                                <Spinner className="size-3.5" />
                              ) : row.accessDisabled ? (
                                "Unsuspend"
                              ) : (
                                "Suspend"
                              )}
                            </Button>
                            {row.deletionStatus !== "pending_wipe" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={busyUserId === row.userId}
                                onClick={() => void softDelete(row)}
                              >
                                Soft-delete
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
