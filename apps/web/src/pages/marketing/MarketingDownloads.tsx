import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircleIcon,
  ContainerIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Page, PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import {
  MARKETING_BASE,
  marketingBadgeClass,
  marketingCardClass,
  marketingCardDescriptionClass,
  marketingCardTitleClass,
  marketingPageDescriptionClass,
  marketingSectionDescriptionClass,
} from "./MarketingLayout";
import {
  type ChannelRelease,
  fetchStableAndNightly,
  formatPublishedAt,
  GHCR_IMAGE,
  GHCR_PACKAGE_URL,
  RELEASES_HUB_URL,
} from "./marketingReleases";

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

function ChannelCard({
  title,
  badge,
  description,
  channel,
  loading,
  error,
}: {
  title: string;
  badge?: string;
  description: string;
  channel: ChannelRelease | null;
  loading: boolean;
  error: boolean;
}) {
  return (
    <Card className={marketingCardClass}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className={marketingCardTitleClass}>{title}</CardTitle>
          {badge ? (
            <Badge variant="secondary" className={marketingBadgeClass}>
              {badge}
            </Badge>
          ) : null}
        </div>
        <CardDescription className={marketingCardDescriptionClass}>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : channel && channel.downloads.length > 0 ? (
          <>
            <p className="text-base text-muted-foreground">
              <span className="font-medium text-foreground">{channel.tag}</span>
              {" · "}
              {formatPublishedAt(channel.publishedAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              {channel.downloads.map((d) => (
                <Button
                  key={d.id}
                  size="sm"
                  render={
                    <a href={d.url} target="_blank" rel="noreferrer" download />
                  }
                >
                  <DownloadIcon data-icon="inline-start" />
                  {d.label}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <Alert>
            <AlertCircleIcon />
            <AlertTitle>
              {error ? "Could not load this channel" : "Unavailable until published"}
            </AlertTitle>
            <AlertDescription>
              Open the GitHub Releases hub for the latest artifacts, or try again
              later.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {channel ? (
          <Button
            variant="outline"
            size="sm"
            render={<a href={channel.htmlUrl} target="_blank" rel="noreferrer" />}
          >
            Release notes
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        ) : null}
        {channel?.manifestUrl ? (
          <Button
            variant="ghost"
            size="sm"
            render={
              <a href={channel.manifestUrl} target="_blank" rel="noreferrer" />
            }
          >
            Manifest
          </Button>
        ) : null}
        {channel?.verificationUrl ? (
          <Button
            variant="ghost"
            size="sm"
            render={
              <a href={channel.verificationUrl} target="_blank" rel="noreferrer" />
            }
          >
            Checksums
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          render={<a href={RELEASES_HUB_URL} target="_blank" rel="noreferrer" />}
        >
          All releases
          <ExternalLinkIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function MarketingDownloads() {
  useDocumentMeta(
    "Downloads · GodMode",
    "Download GodMode Stable or Nightly desktop builds, or run the Docker image for self-host."
  );

  const [stable, setStable] = useState<ChannelRelease | null>(null);
  const [nightly, setNightly] = useState<ChannelRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    void fetchStableAndNightly()
      .then((channels) => {
        if (cancelled) return;
        setStable(channels.stable);
        setNightly(channels.nightly);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setStable(null);
        setNightly(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Page>
      <PageHeader
        title="Downloads"
        description="Install GodMode on your machine. Stable is recommended for most people. Nightly tracks tip of main for testers. Docker is for operators who pin a digest. Binaries stay on GitHub Releases; this page only links them."
        descriptionClassName={marketingPageDescriptionClass}
      />

      <p className={marketingSectionDescriptionClass}>
        Prefer Cloud with no install?{" "}
        <Link className="underline underline-offset-4" to={`${MARKETING_BASE}/pricing`}>
          See Pricing
        </Link>
        . Security notes for self-host:{" "}
        <Link className="underline underline-offset-4" to={`${MARKETING_BASE}/security`}>
          Security
        </Link>
        .
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChannelCard
          title="Stable"
          badge="Recommended"
          description="Latest verified desktop release for Windows, macOS, and Linux."
          channel={stable}
          loading={loading}
          error={error}
        />
        <ChannelCard
          title="Nightly"
          description="Pre-release builds from tip of main. Expect breakage. Use for testing, not daily work."
          channel={nightly}
          loading={loading}
          error={error}
        />
      </div>

      <Card className={marketingCardClass}>
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", marketingCardTitleClass)}>
            <ContainerIcon className="size-5 shrink-0 text-muted-foreground" />
            Docker Image
          </CardTitle>
          <CardDescription className={marketingCardDescriptionClass}>
            Self-host with Compose. Pin an immutable digest for production. Do not
            rely on a floating tag alone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
            {`export GODMODE_IMAGE=${GHCR_IMAGE}@sha256:<digest>
docker compose -f deploy/docker-compose.client.yml pull
docker compose -f deploy/docker-compose.client.yml up -d`}
          </pre>
          <p className="text-base leading-relaxed text-muted-foreground">
            Digests and update helpers are documented in the repo Releases guide.
            SaaS Cloud uses the same image family with Hostinger pin automation.
          </p>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            render={<a href={GHCR_PACKAGE_URL} target="_blank" rel="noreferrer" />}
          >
            GHCR package
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
          <Button
            variant="ghost"
            render={
              <a
                href="https://github.com/ReBoticsAI/GodMode/blob/main/docs/RELEASES.md"
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Releases docs
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
          <Button
            variant="ghost"
            render={<a href={RELEASES_HUB_URL} target="_blank" rel="noreferrer" />}
          >
            GitHub Releases
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        </CardFooter>
      </Card>
    </Page>
  );
}
