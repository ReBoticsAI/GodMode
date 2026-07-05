import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "next-themes";
import { LogOutIcon, MonitorIcon, MoonIcon, SunIcon, UserIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { logoutAuth } from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { USERS_PATH } from "@/lib/navigation";
import { PluginsPanel } from "@/components/PluginsPanel";

const THEME_OPTIONS = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes resolves the active theme only after mount; until then we can't
  // know which option is selected, so we render a neutral state to avoid a flash.
  useEffect(() => {
    setMounted(true);
  }, []);

  const active = mounted ? theme ?? "system" : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Choose how Intelligence looks for you. System follows your operating
          system's light or dark preference.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {THEME_OPTIONS.map(({ value, label, Icon }) => (
          <Button
            key={value}
            type="button"
            variant={active === value ? "default" : "outline"}
            onClick={() => setTheme(value)}
            className={cn("min-w-24 justify-start")}
          >
            <Icon data-icon="inline-start" />
            {label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account &amp; security</CardTitle>
        <CardDescription>
          Profile, password, and sign-in settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          to={USERS_PATH}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
        >
          <UserIcon className="size-4" />
          Open profile
        </Link>
      </CardContent>
    </Card>
  );
}

function SessionCard() {
  const { refresh } = useTenant();

  const signOut = async () => {
    try {
      await logoutAuth();
    } catch {
      /* ignore */
    }
    await refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session</CardTitle>
        <CardDescription>Sign out of GodMode on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => void signOut()}>
          <LogOutIcon data-icon="inline-start" />
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Personal preferences for your account."
      />
      <div className="flex flex-col gap-4">
        <AccountCard />
        <AppearanceCard />
        <PluginsPanel />
        <SessionCard />
      </div>
    </Page>
  );
}
