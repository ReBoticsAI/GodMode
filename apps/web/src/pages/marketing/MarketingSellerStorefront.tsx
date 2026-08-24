import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { StoreIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Page, PageHeader } from "@/components/PageHeader";
import { listingStatusLabel } from "@/lib/marketplace-format";
import {
  MARKETING_BASE,
  marketingBadgeClass,
  marketingCardClass,
  marketingCardDescriptionClass,
  marketingCardTitleClass,
  marketingPageDescriptionClass,
} from "./MarketingLayout";
import {
  cloudBuyListingUrl,
  cloudSellUrl,
  fetchPublicSellerStorefront,
  formatPublicPriceCents,
  type PublicSellerStorefront,
} from "./marketplacePublicApi";

function useDocumentMeta(title: string, description: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    const prevDesc = meta.getAttribute("content");
    meta.setAttribute("content", description);
    return () => {
      document.title = prevTitle;
      if (created) meta?.remove();
      else if (prevDesc != null) meta?.setAttribute("content", prevDesc);
    };
  }, [title, description]);
}

export default function MarketingSellerStorefront() {
  const { handle = "" } = useParams<{ handle: string }>();
  const [store, setStore] = useState<PublicSellerStorefront | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useDocumentMeta(
    handle ? `Seller ${handle} · GodMode Marketplace` : "Seller · GodMode Marketplace",
    store?.listings.length
      ? store.listings
          .map((l) => l.title)
          .join(", ")
          .slice(0, 160)
      : "Public GodMode Community seller storefront."
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      try {
        const next = await fetchPublicSellerStorefront(handle);
        if (cancelled) return;
        if (!next) {
          setNotFound(true);
          setStore(null);
          return;
        }
        setStore(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load storefront");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return (
    <Page>
      <PageHeader
        title={handle ? `Seller ${handle}` : "Seller storefront"}
        description="Listings from this Community seller. Buy and install on GodMode Cloud."
        descriptionClassName={marketingPageDescriptionClass}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="outline" render={<Link to={`${MARKETING_BASE}/marketplace`} />}>
          Browse Marketplace
        </Button>
        <Button variant="outline" render={<a href={cloudSellUrl()} />}>
          Sell on Cloud
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading storefront…</p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {notFound ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <StoreIcon />
            </EmptyMedia>
            <EmptyTitle>Seller not found</EmptyTitle>
            <EmptyDescription>
              This handle is not published. Check the URL or browse the Marketplace.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {!loading && !error && !notFound && store && store.listings.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <StoreIcon />
            </EmptyMedia>
            <EmptyTitle>No public listings yet</EmptyTitle>
            <EmptyDescription>
              This seller has a storefront but no active or pending listings to show.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {store && store.listings.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {store.listings.map((listing) => {
            const pending = listing.status === "pending_payout";
            return (
              <Card key={listing.id} className={marketingCardClass}>
                <CardHeader>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className={marketingBadgeClass}>
                      {listing.kind}
                    </Badge>
                    <Badge
                      variant={pending ? "secondary" : "default"}
                      className={marketingBadgeClass}
                    >
                      {listingStatusLabel(listing.status)}
                    </Badge>
                  </div>
                  <CardTitle className={marketingCardTitleClass}>{listing.title}</CardTitle>
                  <CardDescription className={marketingCardDescriptionClass}>
                    {listing.description || "Community Marketplace listing."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {formatPublicPriceCents(listing.priceCents)}
                </CardContent>
                <CardFooter>
                  {listing.buyEnabled ? (
                    <Button
                      size="sm"
                      render={<a href={cloudBuyListingUrl(listing.id)} />}
                    >
                      Buy on Cloud
                    </Button>
                  ) : (
                    <Button size="sm" disabled>
                      Buy unavailable
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      ) : null}
    </Page>
  );
}
