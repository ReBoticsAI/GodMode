import { useEffect, useState } from "react";
import { fetchAdminMarketplaceFees } from "@/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

function cents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}

export function AdminMarketplaceFeesPanel() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<
    Array<{
      id: string;
      amountCents: number;
      platformFeeCents: number;
      status: string;
      provider: string;
      sellerUserId: string | null;
      createdAt: string;
      deliveredAt: string | null;
    }>
  >([]);
  const [totals, setTotals] = useState({
    paidCount: 0,
    deliveredCount: 0,
    amountCents: 0,
    platformFeeCents: 0,
  });

  useEffect(() => {
    fetchAdminMarketplaceFees()
      .then((res) => {
        setOrders(res.orders);
        setTotals(res.totals);
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to load fees")
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Marketplace U2U fees</CardTitle>
        <CardDescription>
          Read-only ledger of community (user-to-user) orders and platform fees.
          Application fees also appear in the Stripe Dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Paid orders</p>
            <p className="text-lg font-medium">{totals.paidCount}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Delivered</p>
            <p className="text-lg font-medium">{totals.deliveredCount}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">GMV (paid)</p>
            <p className="text-lg font-medium">{cents(totals.amountCents)}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Platform fees</p>
            <p className="text-lg font-medium">{cents(totals.platformFeeCents)}</p>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Fee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No community marketplace orders yet.
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {o.createdAt}
                  </TableCell>
                  <TableCell>{o.status}</TableCell>
                  <TableCell>{o.provider}</TableCell>
                  <TableCell className="text-right">{cents(o.amountCents)}</TableCell>
                  <TableCell className="text-right">
                    {cents(o.platformFeeCents)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
