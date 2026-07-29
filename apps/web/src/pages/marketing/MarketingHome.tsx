import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  BotIcon,
  BrainIcon,
  CalendarDaysIcon,
  CloudIcon,
  LayersIcon,
  PackageIcon,
  PlugIcon,
  PuzzleIcon,
  Share2Icon,
  SparklesIcon,
  StoreIcon,
  UsersIcon,
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
import { APP_NAME } from "@/lib/navigation";
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

const PILLAR_ITEMS = [
  {
    title: "The last platform",
    description:
      "One Control Center for everything you do digitally: yourself, your agents, and your people. Stop stacking another app for every job.",
    Icon: SparklesIcon,
  },
  {
    title: "Self-expanding",
    description:
      "Intelligence builds and extends GodMode from inside GodMode: your layout, tools, packs, and connections grow without leaving the product.",
    Icon: PuzzleIcon,
    slug: "plugin-pipeline",
  },
  {
    title: "Digital You",
    description:
      "Your twin: a private thinking partner and stand-in. It gets sharper as you use the platform, learning how you think and decide.",
    Icon: UsersIcon,
    slug: "digital-you",
  },
  {
    title: "Connect anything",
    description:
      "Wire services, APIs, hardware connectors, and custom packs into the same workspace. Automate and integrate in one home, not a separate silo.",
    Icon: PlugIcon,
    slug: "marketplace",
  },
] as const;

const EXTEND_ITEMS = [
  {
    title: "Grow your workspace",
    description:
      "Start simple, then add departments, pages, and areas as life gets busier. Build it yourself, or ask Intelligence to shape it from chat.",
    Icon: LayersIcon,
    slug: "structure",
  },
  {
    title: "Build and install packs",
    description:
      "Ask Intelligence to scaffold and install what you need, or grab ready-made packs from the Marketplace. Everything lands in the same Control Center.",
    Icon: PuzzleIcon,
    slug: "plugin-pipeline",
  },
  {
    title: "Share live, not files",
    description:
      "Grant live access so teammates work in the same Control Center with you, without export ping-pong.",
    Icon: Share2Icon,
    slug: "shared",
  },
  {
    title: "Open source at the core",
    description:
      "Apache 2.0. Run it yourself for free, or use Cloud when you want the browser path. You are never locked into a black box.",
    Icon: PackageIcon,
  },
] as const;

const OS_FEATURES = [
  {
    title: "Intelligence",
    description:
      "The platform guide that builds with you: setup, structure, wiki, plugins, and cross-cutting work from chat.",
    Icon: BrainIcon,
    slug: "intelligence",
  },
  {
    title: "Digital You",
    description:
      "Stand-in and private thinking partner. Distinct from Intelligence. Grows with Reflection and memory as you use GodMode.",
    Icon: UsersIcon,
    slug: "digital-you",
  },
  {
    title: "Agents",
    description:
      "Specialized helpers under Intelligence for areas of your workspace. Digital You sits beside them as your twin.",
    Icon: BotIcon,
    slug: "agents",
  },
  {
    title: "Wiki and memory",
    description:
      "A living knowledge base so context sticks: notes, rules, skills, and memory that compounds over time.",
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
      "Keys and connections in one safe place, ready for Intelligence and your tools when you need them.",
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

export default function MarketingHome() {
  return (
    <Page>
      <PageHeader
        title={APP_NAME}
        description="Create, edit, organize, and monitor everything you do for yourself, your agents, and your people. Built to be the last platform stack you need."
        descriptionClassName={marketingPageDescriptionClass}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button render={<Link to="/" />}>Open Cloud</Button>
            <Button variant="outline" render={<Link to={`${MARKETING_BASE}/pricing`} />}>
              View pricing
            </Button>
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
              Get the source
            </Button>
            <Button variant="outline" render={<Link to={`${MARKETING_BASE}/features`} />}>
              Features
            </Button>
          </div>
        }
      />

      <Card className={marketingCardClass}>
        <CardHeader>
          <CardTitle className={marketingCardTitleClass}>The last digital home you need</CardTitle>
          <CardDescription className={marketingCardDescriptionClass}>
            GodMode is an open-source Control Center for everything you do digitally. Knowledge,
            work, people, money, and agents live in one place. Intelligence expands the product
            with you. Digital You learns how you think. Connect the services and packs you need
            without stacking another separate tool for every job.
          </CardDescription>
        </CardHeader>
      </Card>

      <section className="flex flex-col gap-4">
        <SectionHeading
          badge="Why GodMode"
          title="Built around what actually matters"
          description="A platform that grows with you, stays open, and aims to be the last stack you adopt."
        />
        <div className="grid gap-4 md:grid-cols-2">
          {PILLAR_ITEMS.map(({ title, description, Icon, ...rest }) => (
            <FeatureCard
              key={title}
              title={title}
              description={description}
              Icon={Icon}
              to={"slug" in rest && rest.slug ? `${MARKETING_BASE}/features/${rest.slug}` : undefined}
            />
          ))}
        </div>
      </section>

      <Card className={marketingCardClass}>
        <CardHeader>
          <CardTitle className={marketingCardTitleClass}>Why Cloud</CardTitle>
          <CardDescription className={marketingCardDescriptionClass}>
            Open GodMode in a browser from any device. We host it and keep it updated so you can
            focus on building your life and work inside the Control Center. Prefer full control?
            Self-host for free. Open source either way.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-wrap gap-2">
          <Button render={<Link to="/" />}>Open Cloud</Button>
          <Button variant="outline" render={<Link to={`${MARKETING_BASE}/pricing`} />}>
            See plans
          </Button>
        </CardFooter>
      </Card>

      <Card className={marketingCardClass}>
        <CardHeader>
          <CardTitle className={marketingCardTitleClass}>Where it is going</CardTitle>
          <CardDescription className={marketingCardDescriptionClass}>
            The same product keeps getting deeper: owned email and domains, fuller money and
            accounting, robots and devices, and GodMode Inference by ReBotics over time. Niche
            professions arrive as Marketplace packs so the core stays universal. Follow the
            public roadmap if you want the build in the open.
          </CardDescription>
        </CardHeader>
        <CardFooter>
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

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          badge="Self-expansion"
          title="It grows from the inside"
          description="You do not outgrow GodMode and migrate. Intelligence helps you extend it: layout, packs, plugins, and connections in the same Control Center."
        />
        <div className="grid gap-4 md:grid-cols-2">
          {EXTEND_ITEMS.map(({ title, description, Icon, ...rest }) => (
            <FeatureCard
              key={title}
              title={title}
              description={description}
              Icon={Icon}
              to={"slug" in rest && rest.slug ? `${MARKETING_BASE}/features/${rest.slug}` : undefined}
            />
          ))}
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          badge="Marketplace"
          title="Connect packs from us and the community"
          description="Need a specialty workflow? Install Official packs or Community listings. Sellers keep most of what they earn. Real money checkout, no credits. Packs are separate from your Cloud subscription."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className={marketingCardClass}>
            <CardHeader>
              <CardTitle className={cn("flex items-center gap-2", marketingCardTitleClass)}>
                <StoreIcon className="size-5 shrink-0 text-muted-foreground" />
                Community
              </CardTitle>
              <CardDescription className={marketingCardDescriptionClass}>
                Buy and sell add-ons person to person. Card, PayPal, and crypto where the seller
                enables them. Sellers keep{" "}
                <strong className="text-foreground">90%</strong>; we take 10%.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-base leading-relaxed text-muted-foreground">
              <p>
                Creators connect payout methods (such as Stripe), publish a listing, and get paid
                for real products.
              </p>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button size="sm" render={<Link to={`${MARKETING_BASE}/features/marketplace`} />}>
                Learn more
              </Button>
              <Button
                size="sm"
                variant="outline"
                render={<Link to={`${MARKETING_BASE}/terms`} />}
              >
                Terms
              </Button>
            </CardFooter>
          </Card>

          <Card className={marketingCardClass}>
            <CardHeader>
              <CardTitle className={marketingCardTitleClass}>Official</CardTitle>
              <CardDescription className={marketingCardDescriptionClass}>
                Packs we curate, free or paid. Paid Official purchases go to the platform as
                merchant of record.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-base leading-relaxed text-muted-foreground">
              Cloud is where paid Official and Community checkout happens. Self-hosted installs
              can still browse and install from the Official catalog.
            </CardContent>
          </Card>

          <Card className={marketingCardClass}>
            <CardHeader>
              <CardTitle className={marketingCardTitleClass}>On your own machine</CardTitle>
              <CardDescription className={marketingCardDescriptionClass}>
                Self-hosters can load private or development plugins on their own computer or
                private server.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-base leading-relaxed text-muted-foreground">
              On GodMode Cloud, installs stay on the Marketplace path for a consistent, safer
              experience. Custom folders are a self-host story; details live on GitHub.
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Inside the Control Center"
          description="Core capabilities that make the last-platform story real. Features pages go deeper; GitHub has the technical docs."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {OS_FEATURES.map(({ title, description, Icon, slug }) => (
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
                Browser access from phone, tablet, or computer. Choose a plan, pay with Stripe,
                create your account, verify email, and you are in. Bring your own AI keys. Cloud
                is also where paid Marketplace checkout lives.
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-wrap gap-2">
              <Button render={<Link to={`${MARKETING_BASE}/pricing`} />}>Pricing</Button>
              <Button
                variant="outline"
                render={<Link to={`${MARKETING_BASE}/security`} />}
              >
                Security
              </Button>
            </CardFooter>
          </Card>
          <Card className={marketingCardClass}>
            <CardHeader>
              <CardTitle className={marketingCardTitleClass}>Self-hosted</CardTitle>
              <CardDescription className={marketingCardDescriptionClass}>
                Free and open source (Apache 2.0). Desktop apps for Windows, macOS, and Linux,
                or run from source. Local models or your own provider keys. Your machine, your
                rules.
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
                Get the source
              </Button>
            </CardFooter>
          </Card>
        </div>
      </section>

      <Card className={marketingCardClass}>
        <CardHeader>
          <CardTitle className={marketingCardTitleClass}>Start in Cloud</CardTitle>
          <CardDescription className={marketingCardDescriptionClass}>
            Choose a Cloud plan, pay, then create your account. Explore features and pricing
            first if you prefer. Technical deep-dives stay on GitHub.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button render={<Link to="/" />}>Open Cloud</Button>
          <Button variant="outline" render={<Link to={`${MARKETING_BASE}/pricing`} />}>
            Pricing
          </Button>
          <Button variant="outline" render={<Link to={`${MARKETING_BASE}/contact`} />}>
            Contact
          </Button>
        </CardContent>
      </Card>
    </Page>
  );
}
