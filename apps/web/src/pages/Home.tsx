import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BellIcon,
  BookOpenIcon,
  BotIcon,
  CalendarDaysIcon,
  ListChecksIcon,
  Share2Icon,
  StoreIcon,
  VaultIcon,
} from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/lib/tenant-context";
import { useIntelligence } from "@/lib/intelligence-context";
import { AI_NAME } from "@/lib/navigation";
import {
  CALENDAR_PATH,
  MARKETPLACE_PATH,
  NOTIFICATIONS_PATH,
  SHARED_PATH,
  TASKS_PATH,
  VAULT_PATH,
  WIKI_PATH,
} from "@/lib/navigation";
import { fetchNotificationUnreadCount } from "@/api";

const QUICK_LINKS = [
  {
    label: "Calendar",
    description: "Events and shared schedules",
    to: CALENDAR_PATH,
    Icon: CalendarDaysIcon,
  },
  {
    label: "Tasks",
    description: "Kanban boards and automations",
    to: TASKS_PATH,
    Icon: ListChecksIcon,
  },
  {
    label: "Wiki",
    description: "Notes and knowledge bases",
    to: WIKI_PATH,
    Icon: BookOpenIcon,
  },
  {
    label: "Vault",
    description: "Secrets and API keys",
    to: VAULT_PATH,
    Icon: VaultIcon,
  },
  {
    label: "Shared",
    description: "Grants from other workspaces",
    to: SHARED_PATH,
    Icon: Share2Icon,
  },
  {
    label: "Marketplace",
    description: "Browse and install packs",
    to: MARKETPLACE_PATH,
    Icon: StoreIcon,
  },
] as const;

const CREATE_DEPARTMENT_PROMPT =
  "Help me create my first department in this workspace. Ask what I want to organize (life, work, hobbies, etc.), suggest a name and icon, then create the department and a starter page under it.";

export default function Home() {
  const { user } = useTenant();
  const { openPanel } = useIntelligence();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    fetchNotificationUnreadCount()
      .then((r) => setUnread(r.unreadCount))
      .catch(() => undefined);
  }, []);

  const name = user?.displayName?.split(" ")[0] ?? "there";

  return (
    <Page>
      <PageHeader
        title={`Welcome, ${name}`}
        description="Your Control Center: create, edit, organize, and monitor everything in one place."
        actions={
          unread > 0 ? (
            <Button variant="outline" size="sm" render={<Link to={NOTIFICATIONS_PATH} />}>
              <BellIcon data-icon="inline-start" />
              {unread} unread
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>How GodMode works</CardTitle>
            <CardDescription>
              A short map of the platform so you know where to start.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">{AI_NAME}</strong> is your platform
              companion: open it from the sidebar to chat, run agents, and build
              automations.
            </p>
            <p>
              <strong className="text-foreground">Personal pages</strong> in the sidebar
              (Calendar, Tasks, Bank, Vault) work across your whole workspace with no setup
              required.
            </p>
            <p>
              <strong className="text-foreground">Departments and pages</strong> organize
              domain-specific work (projects, life areas, hobbies). You start with an empty
              tree; ask {AI_NAME} to create your first department, or use Structure once you
              have pages to arrange.
            </p>
            <p>
              <strong className="text-foreground">Shared</strong> and{" "}
              <strong className="text-foreground">Marketplace</strong> let you collaborate
              with others and install published agents, knowledge, and packs.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => openPanel({ tab: "chat", maximized: false })}>
                <BotIcon data-icon="inline-start" />
                Open {AI_NAME}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  openPanel({
                    tab: "chat",
                    prompt: CREATE_DEPARTMENT_PROMPT,
                    autoSend: true,
                  })
                }
              >
                Create my first department
              </Button>
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Quick links</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map(({ label, description, to, Icon }) => (
              <Link
                key={to}
                to={to}
                className="rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground">{description}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">New here?</CardTitle>
            <CardDescription>
              Read the welcome wiki page for setup tips (Vault keys, agents, marketplace).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link to={`${WIKI_PATH}/welcome`} />}>
              <BookOpenIcon data-icon="inline-start" />
              Open welcome wiki
            </Button>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
