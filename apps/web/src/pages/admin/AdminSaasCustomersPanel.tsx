import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAdminSaasCustomers,
  setAdminSaasCustomerAccess,
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
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
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
    setBusyUserId(row.userId);
    try {
      await setAdminSaasCustomerAccess(row.userId, !row.accessDisabled);
      toast.success(row.accessDisabled ? "Access restored" : "Access disabled");
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
          Paid GodMode Cloud accounts, subscription status, and access controls.
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
                {rows.map((row, idx) => (
                  <tr
                    key={`${row.userId ?? row.email ?? "row"}-${idx}`}
                    className="border-b border-border/60 align-top"
                  >
                    <td className="py-3 pr-3">
                      <div className="font-medium">
                        {row.displayName ?? row.email ?? "Pending signup"}
                      </div>
                      <div className="text-muted-foreground">{row.email ?? "—"}</div>
                      {row.tenantName ? (
                        <div className="text-xs text-muted-foreground">
                          {row.tenantName}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3">
                      {row.planId ?? "—"}
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
                        {row.accessDisabled ? (
                          <Badge variant="destructive">disabled</Badge>
                        ) : null}
                        {row.accessRevoked ? (
                          <Badge variant="outline">revoked</Badge>
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
                              "Enable access"
                            ) : (
                              "Disable access"
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
