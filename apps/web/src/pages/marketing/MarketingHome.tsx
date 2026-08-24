import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  CalendarDaysIcon,
  CloudIcon,
  PackageIcon,
  Share2Icon,
  StoreIcon,
  VaultIcon,
  WorkflowIcon,
} from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  MARKETING_BASE,
  marketingBadgeClass,
  marketingCardClass,
  marketingCardDescriptionClass,
  marketingCardTitleClass,
  marketingPageDescriptionClass,
  marketingSectionDescriptionClass,
  marketingSectionTitleClass,
} from "./MarketingLayout";
import { cn } from "@/lib/utils";
import { CLOUD_APP_HOME } from "./cloudAppUrl";
import { GODMODE_BODY_ANALOGY_PARAS, GODMODE_MANIFESTO } from "@/lib/product-copy";

function SectionHeading({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {badge ? (
        <Badge variant="secondary" className={marketingBadgeClass}>
          {badge}
        </Badge>
      ) : null}
      <h2 className={marketingSectionTitleClass}>{title}</h2>
      <p className={marketingSectionDescriptionClass}>{description}</p>
    </div>
  );
}

function FeatureCard({
  title,
  description,
  Icon,
  to,
}: {
  title: string;
  description: string;
  Icon: LucideIcon;
  to?: string;
}) {
  const header = (
    <CardHeader>
      <CardTitle className={cn("flex items-center gap-2", marketingCardTitleClass)}>
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        {title}
      </CardTitle>
      <CardDescription className={marketingCardDescriptionClass}>
        {description}
      </CardDescription>
    </CardHeader>
  );

  if (!to) {
    return <Card className={marketingCardClass}>{header}</Card>;
  }

  return (
    <Card className={cn(marketingCardClass, "transition-colors hover:bg-muted/40")}>
      <Link to={to} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {header}
      </Link>
    </Card>
  );
}

const BODY_CAST = [
  {
    title: "Structure",
    role: "The Anatomy",
    description:
      "Departments are regions. Divisions group work inside a region. Pages are the surfaces you use. Structure is how the body is organized so you and your agents always know where work lives.",
    image: "/marketing/marketing-structure.png?v=2",
    alt: "Stacked translucent architectural floors forming regions, divisions and page surfaces.",
    slug: "structure",
  },
  {
    title: "Digital You",
    role: "The Persona",
    description:
      "Digital You is your twin inside GodMode, your digital persona. It learns your voice and conventions. It guides you when you are here and stands in when you are not. Distinct from Intelligence: it is your persona, not the platform agent.",
    image: "/marketing/marketing-digital-you.png",
    alt: "Two overlapping figures: a solid silhouette and a luminous twin beside it.",
    slug: "digital-you",
  },
  {
    title: "Intelligence",
    role: "The Nervous System",
    description:
      "Intelligence is the platform agent you talk to in order to grow GodMode and its anatomy. Ask it to extend Structure, install packs, Connect outside services and keep the body expanding from the inside.",
    image: "/marketing/marketing-intelligence.png?v=2",
    alt: "Luminous gold filament network with a bright core spreading through dark space.",
    slug: "intelligence",
  },
  {
    title: "Specialized Agents",
    role: "The Muscles",
    description:
      "Specialized Agents own a job, attach to a region and execute. They are the muscles of the body. Digital You sits beside them as your twin while they carry the work.",
    image: "/marketing/marketing-agents.png",
    alt: "Dark figure with discrete glowing gold nodes at the joints like dedicated job modules.",
    slug: "agents",
  },
] as const;

const SURFACE_FEATURES = [
  {
    title: "Wiki and memory",
    description:
      "A living knowledge base so context sticks: notes, rules, skills and memory that compounds over time.",
    Icon: PackageIcon,
    slug: "wiki",
  },
  {
    title: "Tasks",
    description:
      "Boards with priorities and comments. Hand work to helpers when you want momentum.",
    Icon: WorkflowIcon,
    slug: "tasks",
  },
  {
    title: "Calendar",
    description:
      "Your schedule and activity in one place, with calendar views in chat when helpers need them.",
    Icon: CalendarDaysIcon,
    slug: "calendar",
  },
  {
    title: "Vault",
    description:
      "Platform Vault keeps your Connect keys with your account across workspaces. Personal and Agent vaults hold the rest.",
    Icon: VaultIcon,
    slug: "vault",
  },
  {
    title: "Shared",
    description:
      "Live collaboration with people you trust, without leaving GodMode.",
    Icon: Share2Icon,
    slug: "shared",
  },
] as const;

function CastRow({
  title,
  role,
  description,
  image,
  alt,
  slug,
  reverse,
}: {
  title: string;
  role: string;
  description: string;
  image: string;
  alt: string;
  slug: string;
  reverse?: boolean;
}) {
  return (
    <Card className={cn(marketingCardClass, "gap-0 overflow-hidden py-0")}>
      <div
        className={cn(
          "grid items-stretch lg:grid-cols-2",
          reverse && "lg:[&>*:first-child]:order-2"
        )}
      >
        <img
          src={image}
          alt={alt}
          width={1536}
          height={1024}
          loading="lazy"
          className="aspect-[4/3] h-full w-full object-cover object-center lg:aspect-auto lg:min-h-72"
        />
        <div className="flex flex-col justify-center gap-4 p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <Badge variant="secondary" className={marketingBadgeClass}>
              {role}
            </Badge>
            <CardTitle className={cn(marketingCardTitleClass, "text-2xl")}>{title}</CardTitle>
            <CardDescription className={cn(marketingCardDescriptionClass, "text-base")}>
              {description}
            </CardDescription>
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              render={<Link to={`${MARKETING_BASE}/features/${slug}`} />}
            >
              Learn more
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function MarketingHome() {
  return (
    <Page>
      <PageHeader
        align="center"
        title={
          <img
            src="/marketing/godmode-wordmark.png?v=1"
            alt="GodMode"
            width={992}
            height={280}
            fetchPriority="high"
            className="h-42 w-auto max-w-full object-contain sm:h-48 dark:invert"
          />
        }
        description={GODMODE_MANIFESTO}
        descriptionClassName={marketingPageDescriptionClass}
      />

      <Card className={cn(marketingCardClass, "gap-0 py-0")}>
        <div className="relative">
          <img
            src="/marketing/godmode-hero-banner.png?v=5"
            alt="Two figures on a dark grid: a translucent digital body with a gold nervous system and a twin silhouette behind it."
            width={1536}
            height={864}
            fetchPriority="high"
            className="aspect-video w-full object-cover object-top"
          />
          <div
            className={cn(
              "flex flex-col justify-start gap-6 p-4 sm:p-6",
              "lg:absolute lg:inset-y-0 lg:left-0 lg:flex lg:w-[min(40rem,58%)] lg:justify-center lg:px-6 lg:py-6",
              "lg:bg-gradient-to-r lg:from-black/90 lg:via-black/70 lg:to-transparent"
            )}
          >
            <CardHeader className="gap-1 px-0">
              <CardTitle
                className={cn(
                  marketingCardTitleClass,
                  "text-3xl [text-box:trim-start_cap_alphabetic] lg:text-4xl lg:text-white"
                )}
              >
                Digital Body
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 px-0 text-base leading-relaxed text-muted-foreground lg:text-2xl lg:text-white/80">
              {GODMODE_BODY_ANALOGY_PARAS.map((para) => (
                <p key={para.slice(0, 48)}>{para}</p>
              ))}
            </CardContent>
          </div>
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <SectionHeading
          badge="The Body"
          title="Four roles. One home."
          description="GodMode is one place with Structure to hold the work, Digital You as your persona, Intelligence to grow the system from chat and specialized agents to execute. These four roles are how the body stays coherent as it expands."
        />
        <div className="flex flex-col gap-4">
          {BODY_CAST.map((item, index) => (
            <CastRow key={item.slug} {...item} reverse={index % 2 === 1} />
          ))}
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          badge="Marketplace"
          title="Earn on what you build"
          description="List the packs, plugins and workflows you already figured out. Other people install them instead of burning time and tokens from zero. Sellers keep 90%."
        />
        <Card className={cn(marketingCardClass, "gap-0 overflow-hidden py-0")}>
          <div className="grid items-stretch lg:grid-cols-2">
            <img
              src="/marketing/marketing-connect.png?v=2"
              alt="Light streams and modules docking into a dark digital body silhouette."
              width={1536}
              height={1024}
              loading="lazy"
              className="aspect-[4/3] h-full w-full object-cover object-center lg:aspect-auto lg:min-h-72"
            />
            <div className="flex flex-col justify-center gap-4 p-6 sm:p-8">
              <CardTitle className={cn(marketingCardTitleClass, "text-2xl")}>
                Community Marketplace
              </CardTitle>
              <CardDescription className={cn(marketingCardDescriptionClass, "text-base")}>
                GodMode is a place to earn. Publish what you built, set a price and get paid when
                someone skips reinventing it. Buyers get a head start. You keep most of the sale.
              </CardDescription>
              <div className="flex flex-wrap gap-2">
                <Button
                  render={<Link to={`${MARKETING_BASE}/features/plugin-pipeline`} />}
                >
                  Build and List a Plugin
                </Button>
                <Button
                  variant="outline"
                  render={<Link to={`${MARKETING_BASE}/features/marketplace`} />}
                >
                  Browse Marketplace
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className={marketingCardClass}>
            <CardHeader>
              <CardTitle className={cn("flex items-center gap-2", marketingCardTitleClass)}>
                <StoreIcon className="size-5 shrink-0 text-muted-foreground" />
                Sell once. Earn repeatedly.
              </CardTitle>
              <CardDescription className={marketingCardDescriptionClass}>
                Person-to-Person listings with Stripe Connect. Sellers keep{" "}
                <strong className="text-foreground">90%</strong>. The platform takes 10%.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-base leading-relaxed text-muted-foreground">
              Connect payouts, publish a listing and get paid for real products. The same pack that
              saves you time and tokens can help the next person save theirs.
            </CardContent>
          </Card>

          <Card className={marketingCardClass}>
            <CardHeader>
              <CardTitle className={marketingCardTitleClass}>Buy a Head Start</CardTitle>
              <CardDescription className={marketingCardDescriptionClass}>
                Install Community and Official plugins & packs instead of spending runs reinventing
                Connectors, Workflows and Agent setups.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-base leading-relaxed text-muted-foreground">
              Official packs are curated by us (free or paid). Community packs come from builders
              like you. Both land in the same home.
            </CardContent>
          </Card>

          <Card className={marketingCardClass}>
            <CardHeader>
              <CardTitle className={marketingCardTitleClass}>Still yours to Connect</CardTitle>
              <CardDescription className={marketingCardDescriptionClass}>
                Ask Intelligence to Connect outside services, or load private plugins on a machine
                you control.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-base leading-relaxed text-muted-foreground">
              On Self-Hosted, keep private and development plugin folders for work you are not
              listing yet. Official and Community Marketplace stay available to browse and install
              from Cloud or Self-Hosted.
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          badge="Surfaces"
          title="Where the work lives"
          description="Structure holds the anatomy. These surfaces are where day-to-day work happens for you, your people and your agents."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACE_FEATURES.map(({ title, description, Icon, slug }) => (
            <FeatureCard
              key={title}
              title={title}
              description={description}
              Icon={Icon}
              to={`${MARKETING_BASE}/features/${slug}`}
            />
          ))}
        </div>
        <div>
          <Button variant="outline" render={<Link to={`${MARKETING_BASE}/features`} />}>
            Browse all features
          </Button>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Cloud for convenience. Open source for freedom."
          description="Most people who want GodMode from any device choose Cloud. Builders and privacy-first users self-host for free."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card className={marketingCardClass}>
            <CardHeader>
              <CardTitle className={cn("flex items-center gap-2", marketingCardTitleClass)}>
                <CloudIcon className="size-5 shrink-0 text-muted-foreground" />
                GodMode Cloud
              </CardTitle>
              <CardDescription className={marketingCardDescriptionClass}>
                Browser access from phone, tablet or computer. Choose a plan, pay with Stripe,
                create your account, verify email and you are in. Bring your own AI Keys or
                Subscriptions (we recommend Cursor).
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-wrap gap-2">
              <Button render={<a href={CLOUD_APP_HOME} />}>Open Cloud</Button>
              <Button variant="outline" render={<Link to={`${MARKETING_BASE}/pricing`} />}>
                Pricing
              </Button>
              <Button variant="outline" render={<Link to={`${MARKETING_BASE}/security`} />}>
                Security
              </Button>
            </CardFooter>
          </Card>
          <Card className={marketingCardClass}>
            <CardHeader>
              <CardTitle className={marketingCardTitleClass}>Self-Hosted</CardTitle>
              <CardDescription className={marketingCardDescriptionClass}>
                Free and open source (Apache 2.0). Desktop apps for Windows, macOS and Linux, or run
                from source. Local models or your own provider keys. Your machine, your rules.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                variant="outline"
                render={
                  <a
                    href="https://github.com/ReBoticsAI/GodMode"
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                GitHub
              </Button>
            </CardFooter>
          </Card>
        </div>
      </section>

      <Card className={marketingCardClass}>
        <CardHeader>
          <CardTitle className={marketingCardTitleClass}>The Roadmap Ahead</CardTitle>
          <CardDescription className={marketingCardDescriptionClass}>
            The same product keeps getting deeper: owned email and domains, fuller money and
            accounting, robots and devices, and GodMode Inference by ReBotics over time. Niche
            professions arrive as Marketplace packs so the core stays universal. Follow the public
            roadmap if you want to see us build in the open or join us and make contributions
            yourself!
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            render={
              <a
                href="https://github.com/users/ReBoticsAI/projects/1"
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Open Roadmap
          </Button>
        </CardFooter>
      </Card>
    </Page>
  );
}
