import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminMarketplaceReviewQueue,
  reviewAdminMarketplaceListing,
  type MarketplaceListing,
} from "@/api";
import { listingStatusLabel, formatMarketplaceCents } from "@/lib/marketplace-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export function AdminMarketplaceReviewPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);

  const reload = useCallback(() => {
    setLoading(true);
    fetchAdminMarketplaceReviewQueue()
      .then((res) => setListings(res.listings))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to load review queue")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const review = async (id: string, action: "approve" | "reject") => {
    setSaving(true);
    try {
      await reviewAdminMarketplaceListing(id, action);
      toast.success(action === "approve" ? "Listing is public" : "Listing archived");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Listing review</CardTitle>
        <CardDescription>
          Clone, live, and inference listings wait here. Plugins with catalog CI skip this queue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner />
        ) : listings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No listings awaiting review.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {listings.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.title}</TableCell>
                  <TableCell>{row.kind}</TableCell>
                  <TableCell>{row.delivery_mode ?? "clone"}</TableCell>
                  <TableCell>{formatMarketplaceCents(row.price_cents)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{listingStatusLabel(row.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={saving}
                        onClick={() => void review(row.id, "approve")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() => void review(row.id, "reject")}
                      >
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
