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
    title: "Grow your workspace",
    description:
      "Start simple, then add departments, pages, and areas as life gets busier. Build the layout yourself, or ask Intelligence to help shape it from chat.",
    Icon: LayersIcon,
    slug: "structure",
  },
  {
    title: "Add-ons and plugins",
    description:
      "Install ready-made packs from the Marketplace, or ask Intelligence to help build something new. Extra tools and pages plug into the same Control Center.",
    Icon: PuzzleIcon,
    slug: "plugin-pipeline",
  },
  {
    title: "Custom records and actions",
    description:
      "Extensions can add their own kinds of records and buttons that feel native. Specialized workflows live beside your everyday tasks and notes.",
    Icon: WorkflowIcon,
    slug: "objecttype-records",
  },
  {
    title: "Share with people you trust",
    description:
      "Grant live access to parts of your workspace so a teammate, partner, or collaborator can work in the same Control Center with you.",
    Icon: Share2Icon,
    slug: "shared",
  },
] as const;

const OS_FEATURES = [
  {
    title: "Intelligence",
    description:
      "Your in-app guide: chat to set things up, organize work, edit the wiki, and get help across GodMode.",
    Icon: BrainIcon,
    slug: "intelligence",
  },
  {
    title: "Digital You",
    description:
      "A digital twin that learns how you work and can stand in when you are busy. Separate from Intelligence, the platform guide.",
    Icon: UsersIcon,
    slug: "digital-you",
  },
  {
    title: "Agents",
    description:
      "Organize helpers under Intelligence and Digital You. Configure models, tools, and rules so each agent has a clear job.",
    Icon: BotIcon,
    slug: "agents",
  },
  {
    title: "Wiki and memory",
    description:
      "A living knowledge base: notes, rules, skills, and longer-term memory so context sticks around between chats.",
    Icon: PackageIcon,
    slug: "wiki",
  },
  {
    title: "Tasks",
    description:
      "Boards with priorities and comments. Mark a card for auto when you want an agent to pick it up.",
    Icon: WorkflowIcon,
    slug: "tasks",
  },
  {
    title: "Calendar",
    description:
      "Your events and activity in one place. Agents can work from their own calendar view in chat.",
    Icon: CalendarDaysIcon,
    slug: "calendar",
  },
  {
    title: "Vault",
    description:
      "A safe place for API keys and connected accounts, available from Settings and from chat when you need them.",
    Icon: VaultIcon,
    slug: "vault",
  },
  {
    title: "Shared",
    description:
      "See what others have shared with you, and collaborate without exporting files back and forth.",
    Icon: Share2Icon,
    slug: "shared",
  },
] as const;

export default function MarketingHome() {
  return (
    <Page>
      <PageHeader
        title={APP_NAME}
        description="Your Control Center for life and work: notes, tasks, calendar, people, money tracking, and AI helpers in one place. Use GodMode Cloud in the browser from any device when you want simplicity. Or run it yourself for free. Open source either way."
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
          <CardTitle>One place for everything</CardTitle>
          <CardDescription>
            GodMode is built so you are not juggling a dozen apps for the same life. Keep a
            wiki of what you know, run projects on boards, track contacts, watch wallets and a
            simple ledger in Bank, and lean on Intelligence when you want a guide. Digital You
            is your twin for when you need coverage. Deeper bookkeeping-style accounting is
            still growing. Niche hobbies and professional domains arrive as Marketplace
            add-ons so the core stays clean.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Why Cloud</CardTitle>
          <CardDescription>
            GodMode Cloud is for people who want GodMode without installing or babysitting
            software. Open a browser on your phone, laptop, or work machine and pick up where
            you left off. We host it, keep it updated, and handle the boring ops. Prefer to
            own every bit yourself? Self-host stays free and first-class. Developers can dig
            into setup and architecture on GitHub.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-wrap gap-2">
          <Button render={<Link to="/" />}>Try Cloud</Button>
          <Button variant="outline" render={<Link to={`${MARKETING_BASE}/pricing`} />}>
            See plans
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What is coming next</CardTitle>
          <CardDescription>
            GodMode is useful today and still expanding: richer email and domains, deeper
            money tools, robots and devices, and more ownership of AI infrastructure over
            time. Follow the public roadmap if you like watching the build.
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
          badge="Made to grow with you"
          title="Start simple. Add depth when you need it"
          description="You do not have to configure everything on day one. Grow your workspace layout, install add-ons when a new need appears, and share live access with people you trust."
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
          badge="Marketplace"
          title="Extend GodMode with packs from us and the community"
          description="Need a specialty workflow? Browse Official packs we curate, or Community listings from other creators. Sellers keep most of what they earn. Buying a pack is separate from your Cloud subscription."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <StoreIcon className="size-4 shrink-0 text-muted-foreground" />
                Community
              </CardTitle>
              <CardDescription>
                Buy and sell add-ons person to person. Checkout supports card, PayPal, and
                crypto where the seller enables them. Sellers keep{" "}
                <strong className="text-foreground">90%</strong>; we take 10%.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-base text-muted-foreground">
              <p>
                Creators connect payout methods, publish a listing, and manage what they sell.
                Buyers pay for a real product, not platform credits.
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Official</CardTitle>
              <CardDescription>
                Packs we curate ourselves, free or paid. Paid Official purchases go to the
                platform as merchant of record.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-base text-muted-foreground">
              Cloud is where paid Official and Community checkout happens. Self-hosted installs
              can still browse and install from the Official catalog.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">On your own machine</CardTitle>
              <CardDescription>
                Self-hosters can also load private or development plugins on their own
                computer or private server.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-base text-muted-foreground">
              On GodMode Cloud we keep installs on the Marketplace path so everyone gets a
              consistent, safer experience. Power users who want custom folders should self-host;
              setup details are on GitHub.
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Why this matters</CardTitle>
            <CardDescription>
              GodMode is meant to grow with you, not lock you into one fixed set of screens.
              Intelligence can help you build and install add-ons. The Marketplace is how those
              packs reach other people with clear listings, orders, and payouts.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="What you get in the Control Center"
          description="These capabilities ship in the core product. Features pages go deeper; GitHub has the full technical docs."
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
          title="Cloud convenience, or run it yourself"
          description="Most people who want GodMode from any device without managing installs choose Cloud. Builders and privacy maximalists can still download and self-host for free."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CloudIcon className="size-4 shrink-0 text-muted-foreground" />
                GodMode Cloud
              </CardTitle>
              <CardDescription>
                Open GodMode in your browser from phone, tablet, or computer. We host and
                update it. Choose a plan, pay with Stripe, create your account, verify email,
                and you are in. Cloud is also where paid Marketplace checkout lives.
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Self-hosted</CardTitle>
              <CardDescription>
                Free and open source (Apache 2.0). Desktop apps for Windows, macOS, and Linux,
                or run from source if you are comfortable with that. Connect local AI models or
                your own provider keys. Best when you want everything on hardware you control.
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

      <Card>
        <CardHeader>
          <CardTitle>Ready when you are</CardTitle>
          <CardDescription>
            Open Cloud to sign in or start a plan. Prefer to explore first? Read features,
            compare pricing, or email support. Technical deep-dives stay on GitHub.
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
