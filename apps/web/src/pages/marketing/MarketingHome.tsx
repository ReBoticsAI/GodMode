import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  BotIcon,
  BrainIcon,
  CalendarDaysIcon,
  CloudIcon,
  LayersIcon,
  PackageIcon,
  PuzzleIcon,
  Share2Icon,
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
import { MARKETING_BASE } from "./MarketingLayout";

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
        <Badge variant="secondary" className="w-fit">
          {badge}
        </Badge>
      ) : null}
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="max-w-5xl text-base leading-relaxed text-muted-foreground">{description}</p>
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
      <CardTitle className="flex items-center gap-2 text-base">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        {title}
      </CardTitle>
      <CardDescription className="text-base leading-relaxed">{description}</CardDescription>
    </CardHeader>
  );

  if (!to) {
    return <Card>{header}</Card>;
  }

  return (
    <Card className="transition-colors hover:bg-muted/40">
      <Link to={to} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {header}
      </Link>
    </Card>
  );
}

const EXTEND_ITEMS = [
  {
    title: "Grow Structure",
    description:
      "Departments, divisions, and pages start empty and expand as you work. Create them in the Structure editor or ask Intelligence to build the tree from chat.",
    Icon: LayersIcon,
    slug: "structure",
  },
  {
    title: "Plugin pipeline",
    description:
      "Scaffold, build, and install plugins from Intelligence, or ship packs through Marketplace. Domain packs add pages, tools, and ObjectTypes without forking core.",
    Icon: PuzzleIcon,
    slug: "plugin-pipeline",
  },
  {
    title: "ObjectType kernel",
    description:
      "Plugins register records, named actions, and UI against a durable mutation boundary. Extend the Control Center the same way first-party domains do.",
    Icon: WorkflowIcon,
    slug: "objecttype-records",
  },
  {
    title: "Shared federation",
    description:
      "Grant live resources to your team. Shared surfaces and cross-home federation connect people inside the same Control Center model.",
    Icon: Share2Icon,
    slug: "shared",
  },
] as const;

const OS_FEATURES = [
  {
    title: "Intelligence",
    description:
      "Platform companion with tools: setup, structure, wiki, and cross-cutting work from the Chat panel.",
    Icon: BrainIcon,
    slug: "intelligence",
  },
  {
    title: "Digital You",
    description:
      "Your digital twin: learns from how you use the platform and can stand in when you are unavailable. Distinct from Intelligence.",
    Icon: UsersIcon,
    slug: "digital-you",
  },
  {
    title: "Agents org chart",
    description:
      "Intelligence and Digital You at the root; department subagents below. Pipeline configures models, tools, rules, and profiles.",
    Icon: BotIcon,
    slug: "agents",
  },
  {
    title: "Wiki and memory",
    description:
      "Markdown knowledge base plus rules, skills, semantic memory, and reflection. Durable context, not a chat transcript.",
    Icon: PackageIcon,
    slug: "wiki",
  },
  {
    title: "Tasks and auto",
    description:
      "Kanban boards with priorities and comments. Tag a card auto to queue autonomous agent work.",
    Icon: WorkflowIcon,
    slug: "tasks",
  },
  {
    title: "Calendar",
    description:
      "Personal events and activity feed; agents get their own calendar workspace in Chat.",
    Icon: CalendarDaysIcon,
    slug: "calendar",
  },
  {
    title: "Vault",
    description:
      "Secrets, API keys, and Cursor subscription connect. Available in Settings and as a Chat tab.",
    Icon: VaultIcon,
    slug: "vault",
  },
  {
    title: "Shared",
    description:
      "Live resources another user granted you, plus federation tooling for cross-home collaboration.",
    Icon: Share2Icon,
    slug: "shared",
  },
] as const;

export default function MarketingHome() {
  return (
    <Page>
      <PageHeader
        title={APP_NAME}
        description="Your Control Center: create, edit, organize, and monitor everything you do for yourself, your agents, and your people. Open source. Local-first. Self-host or use Cloud for convenience. Extend through Marketplace. Share with your team."
        descriptionClassName="max-w-5xl text-base leading-relaxed"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button render={<Link to="/" />}>Open Cloud</Button>
            <Button variant="outline" render={<Link to={`${MARKETING_BASE}/features`} />}>
              Features
            </Button>
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
              Roadmap
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>One Control Center</CardTitle>
          <CardDescription>
            Create, edit, organize, and monitor knowledge and wiki, tasks and project
            management, contacts and relationships, accounting, and day-to-day work, with
            Intelligence as your platform guide and Digital You as your twin. Built to be the
            last platform stack you need. Niche domains ship as plugins via Marketplace.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roadmap</CardTitle>
          <CardDescription>
            GodMode is usable today. Core still grows (owned email and domains, accounting
            depth, robot and IoT actors, owned inference and training, and more). Follow
            progress on the public Roadmap Project.
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
          badge="Designed to be extended"
          title="Build on the platform, not around it"
          description="GodMode ships as a Control Center with an explicit extension surface: Structure you grow, plugins you install or author, ObjectTypes that register new domains, and Shared grants for your team."
        />
        <div className="grid gap-4 md:grid-cols-2">
          {EXTEND_ITEMS.map(({ title, description, Icon, slug }) => (
            <FeatureCard
              key={title}
              title={title}
              description={description}
              Icon={Icon}
              to={`${MARKETING_BASE}/features/${slug}`}
            />
          ))}
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          badge="User-to-user Marketplace"
          title="Sell and buy extensions with real checkout"
          description="Marketplace is how the community extends GodMode. Official packs are curated. Community listings are user-to-user commerce; sellers keep 90%."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <StoreIcon className="size-4 shrink-0 text-muted-foreground" />
                Community (U2U)
              </CardTitle>
              <CardDescription>
                Publish listings, buyers check out with card / PayPal / crypto, then acquire.
                Sellers keep <strong className="text-foreground">90%</strong>; the platform
                takes 10%.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-base text-muted-foreground">
              <p>
                Sell tab: accept ToS, connect Stripe Connect, PayPal, and/or MetaMask, then
                publish and manage My listings.
              </p>
              <p>No credits. Purchases are real money (or crypto) against a listing.</p>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button size="sm" render={<Link to={`${MARKETING_BASE}/features/marketplace`} />}>
                Marketplace docs
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Official</CardTitle>
              <CardDescription>
                Curated ReBotics catalog (free and paid). Paid Official revenue is 100% to the
                platform (merchant of record).
              </CardDescription>
            </CardHeader>
            <CardContent className="text-base text-muted-foreground">
              Local and private-hub installs pull the Official feed; GodMode Cloud is the
              commerce authority for paid checkout.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Local</CardTitle>
              <CardDescription>
                Local plugin folders and third-party catalog URLs for free or self-managed
                packs. Not the Community user-listing feed.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-base text-muted-foreground">
              Ideal for private packs and development. SaaS surfaces focus Official + Community
              commerce.
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Why Marketplace matters</CardTitle>
            <CardDescription>
              Extension is not a side door. It is the product. Intelligence can scaffold and
              install plugins; Marketplace is how those packs (and yours) reach other users with
              durable listings, orders, and payouts on the ObjectType kernel.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Built into the Control Center"
          description="Everything below ships in core. Then you extend it with Structure, plugins, and Marketplace."
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
          title="Run it your way"
          description="Self-host for free on your machine or private hub. Or use GodMode Cloud for hosted multi-tenant SaaS with Marketplace commerce."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Self-hosted</CardTitle>
              <CardDescription>
                Open source (Apache 2.0). Local-first on your machine or private hub. Local
                LLMs, Cursor Cloud, or provider keys in Vault.
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CloudIcon className="size-4 shrink-0 text-muted-foreground" />
                GodMode Cloud
              </CardTitle>
              <CardDescription>
                Hosted seats with paywall signup, email verification, and admin MFA. Commerce
                authority for paid Official and Community Marketplace.
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
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Get started</CardTitle>
          <CardDescription>
            Open Cloud to sign in, compare plans, or reach us with questions.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button render={<Link to="/" />}>Sign in / Sign up</Button>
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
