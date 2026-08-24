import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Page, PageHeader } from "@/components/PageHeader";
import { formatMarketplaceCents } from "@/lib/marketplace-format";
import {
  MARKETING_BASE,
  marketingBadgeClass,
  marketingCardClass,
  marketingCardDescriptionClass,
  marketingCardTitleClass,
  marketingPageDescriptionClass,
} from "./MarketingLayout";
import {
  cloudCommunityMarketplaceUrl,
  cloudOfficialMarketplaceUrl,
  cloudSellUrl,
  fetchPublicCommunityCatalog,
  fetchPublicOfficialCatalog,
  formatPublicPriceCents,
  type PublicCatalogListing,
  type PublicOfficialEntry,
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

export default function MarketingMarketplace() {
  useDocumentMeta(
    "Marketplace · GodMode",
    "Browse Official and Community Marketplace listings. Buy and install on GodMode Cloud."
  );

  const [official, setOfficial] = useState<PublicOfficialEntry[]>([]);
  const [community, setCommunity] = useState<PublicCatalogListing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [off, com] = await Promise.all([
          fetchPublicOfficialCatalog(),
          fetchPublicCommunityCatalog(),
        ]);
        if (cancelled) return;
        setOfficial(off.entries);
        setCommunity(com.listings);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Marketplace");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Page>
      <PageHeader
        title="Marketplace"
        description="Browse Official and Community listings. Checkout and install happen on GodMode Cloud."
        descriptionClassName={marketingPageDescriptionClass}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Button render={<a href={cloudOfficialMarketplaceUrl()} />}>Open Official on Cloud</Button>
        <Button variant="outline" render={<a href={cloudCommunityMarketplaceUrl()} />}>
          Open Community on Cloud
        </Button>
        <Button variant="outline" render={<a href={cloudSellUrl()} />}>
          Sell on Cloud
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Tabs defaultValue="official">
        <TabsList>
          <TabsTrigger value="official">Official</TabsTrigger>
          <TabsTrigger value="community">Community</TabsTrigger>
        </TabsList>

        <TabsContent value="official" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading Official catalog…</p>
          ) : official.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <StoreIcon />
                </EmptyMedia>
                <EmptyTitle>No Official listings yet</EmptyTitle>
                <EmptyDescription>
                  Check back soon, or open the Official tab on Cloud.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {official.map((entry) => {
                const title = entry.title || entry.name || entry.id;
                const price = formatPublicPriceCents(
                  entry.priceCents ?? entry.price_cents
                );
                return (
                  <Card key={entry.id} className={marketingCardClass}>
                    <CardHeader>
                      <Badge variant="secondary" className={marketingBadgeClass}>
                        Official
                      </Badge>
                      <CardTitle className={marketingCardTitleClass}>{title}</CardTitle>
                      <CardDescription className={marketingCardDescriptionClass}>
                        {entry.description || "Official catalog entry."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">{price}</CardContent>
                    <CardFooter>
                      <Button
                        size="sm"
                        render={<a href={cloudOfficialMarketplaceUrl()} />}
                      >
                        View on Cloud
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="community" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading Community listings…</p>
          ) : community.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <StoreIcon />
                </EmptyMedia>
                <EmptyTitle>No Community listings yet</EmptyTitle>
                <EmptyDescription>
                  Sellers publish from Cloud.{" "}
                  <Link
                    to={`${MARKETING_BASE}/marketplace`}
                    className="underline underline-offset-2"
                  >
                    Refresh
                  </Link>{" "}
                  after new listings go live.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {community.map((listing) => (
                <Card key={listing.id} className={marketingCardClass}>
                  <CardHeader>
                    <Badge variant="outline" className={marketingBadgeClass}>
                      {listing.kind || "listing"}
                    </Badge>
                    <CardTitle className={marketingCardTitleClass}>
                      {listing.title || listing.id}
                    </CardTitle>
                    <CardDescription className={marketingCardDescriptionClass}>
                      {listing.description || "Community Marketplace listing."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {formatMarketplaceCents(listing.price_cents)}
                  </CardContent>
                  <CardFooter>
                    <Button
                      size="sm"
                      render={<a href={cloudCommunityMarketplaceUrl()} />}
                    >
                      Buy on Cloud
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
