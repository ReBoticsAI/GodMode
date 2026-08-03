import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminMarketplaceSellers,
  setAdminMarketplaceSellerFrozen,
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

function tierBadgeLabel(tier: number | undefined): string | null {
  const t = Number(tier ?? 0);
  if (t >= 3) return "Verified III";
  if (t >= 2) return "Verified II";
  if (t >= 1) return "Verified I";
  return null;
}

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
      toast.success(
        verifiedSeller ? "Seller floor set to Verified I" : "Verified floor cleared"
      );
      setUserId("");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update verified seller");
    } finally {
      setSaving(false);
    }
  };

  const setFrozen = async (targetUserId: string, verifiedFrozen: boolean) => {
    setSaving(true);
    try {
      await setAdminMarketplaceSellerFrozen({ userId: targetUserId, verifiedFrozen });
      toast.success(verifiedFrozen ? "Seller trust frozen" : "Seller trust unfrozen");
      setUserId("");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update seller freeze");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Community verified sellers</CardTitle>
        <CardDescription>
          Sellers earn Verified I / II / III from 3 / 5 / 10 active public Community
          listings. Use floor to grant Verified I early, or freeze to hide badges.
          This is an identity signal, not a substitute for install pins or capability
          grants.
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
              {saving ? "Saving…" : "Floor Verified I"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || !userId.trim()}
              onClick={() => void setVerified(userId.trim(), false)}
            >
              Clear floor
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || !userId.trim()}
              onClick={() => void setFrozen(userId.trim(), true)}
            >
              Freeze
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || !userId.trim()}
              onClick={() => void setFrozen(userId.trim(), false)}
            >
              Unfreeze
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
                <TableHead>Listings</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sellers.map((s) => {
                const label = tierBadgeLabel(s.verifiedTier);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">{s.email ?? "n/a"}</TableCell>
                    <TableCell className="font-mono text-xs">{s.userId}</TableCell>
                    <TableCell className="text-sm">{s.onboardingStatus}</TableCell>
                    <TableCell className="text-sm">{s.listingCount ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {label ? (
                          <Badge variant="outline">{label}</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">None</span>
                        )}
                        {s.verifiedFrozen ? (
                          <Badge variant="secondary">Frozen</Badge>
                        ) : null}
                        {s.verifiedSeller ? (
                          <Badge variant="secondary">Floor I</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={saving}
                          onClick={() => void setVerified(s.userId, !s.verifiedSeller)}
                        >
                          {s.verifiedSeller ? "Clear floor" : "Floor I"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={saving}
                          onClick={() => void setFrozen(s.userId, !s.verifiedFrozen)}
                        >
                          {s.verifiedFrozen ? "Unfreeze" : "Freeze"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
