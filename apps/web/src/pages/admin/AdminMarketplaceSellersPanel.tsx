import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminMarketplaceSellers,
  setAdminMarketplaceSellerVerified,
  type AdminMarketplaceSellerRow,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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

export function AdminMarketplaceSellersPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sellers, setSellers] = useState<AdminMarketplaceSellerRow[]>([]);
  const [userId, setUserId] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    fetchAdminMarketplaceSellers()
      .then((res) => setSellers(res.sellers))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to load sellers")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const setVerified = async (targetUserId: string, verifiedSeller: boolean) => {
    setSaving(true);
    try {
      await setAdminMarketplaceSellerVerified({ userId: targetUserId, verifiedSeller });
      toast.success(verifiedSeller ? "Seller marked verified" : "Verified flag cleared");
      setUserId("");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update verified seller");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Community verified sellers</CardTitle>
        <CardDescription>
          Flag Community (user) sellers as Verified. Buyers see a Verified badge on their
          listings. This is an identity signal, not a substitute for install pins or
          capability grants.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup className="max-w-xl">
          <Field>
            <FieldLabel htmlFor="verified-seller-user-id">Seller user id</FieldLabel>
            <Input
              id="verified-seller-user-id"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Paste user id"
              autoComplete="off"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={saving || !userId.trim()}
              onClick={() => void setVerified(userId.trim(), true)}
            >
              {saving ? "Saving…" : "Mark verified"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || !userId.trim()}
              onClick={() => void setVerified(userId.trim(), false)}
            >
              Clear verified
            </Button>
          </div>
        </FieldGroup>

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : sellers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No seller accounts yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>User id</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sellers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">{s.email ?? "n/a"}</TableCell>
                  <TableCell className="font-mono text-xs">{s.userId}</TableCell>
                  <TableCell className="text-sm">{s.onboardingStatus}</TableCell>
                  <TableCell>
                    {s.verifiedSeller ? (
                      <Badge variant="outline">Verified</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void setVerified(s.userId, !s.verifiedSeller)}
                    >
                      {s.verifiedSeller ? "Clear" : "Verify"}
                    </Button>
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
