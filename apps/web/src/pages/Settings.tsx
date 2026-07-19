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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  beginMfaEnroll,
  confirmMfaEnroll,
  disableMfa,
  fetchMfaStatus,
  logoutAuth,
} from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { USERS_PATH } from "@/lib/navigation";
import { SubscriptionCard } from "@/components/settings/SubscriptionCard";
import { toast } from "sonner";

const THEME_OPTIONS = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

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

function MfaCard() {
  const { user, refresh } = useTenant();
  const [enabled, setEnabled] = useState(false);
  const [required, setRequired] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => {
    void fetchMfaStatus()
      .then((s) => {
        setEnabled(s.enabled);
        setRequired(s.required);
      })
      .catch(() => {
        /* optional when logged out */
      });
  };

  useEffect(() => {
    reload();
  }, []);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const res = await beginMfaEnroll();
      setSecret(res.secretBase32);
      setOtpauthUrl(res.otpauthUrl);
      setRecoveryCodes(res.recoveryCodes);
      toast.message("Scan the secret in your authenticator, then confirm with a code");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start MFA");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await confirmMfaEnroll(code.trim());
      setSecret(null);
      setOtpauthUrl(null);
      setCode("");
      toast.success("MFA enabled");
      await refresh();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disableMfa(code.trim());
      setCode("");
      toast.success("MFA disabled");
      await refresh();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disable MFA");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>
          {required
            ? "Required for platform admins on GodMode Cloud."
            : "Optional TOTP authenticator for your account."}
          {user?.mfaEnabled || enabled ? " MFA is currently on." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {secret ? (
          <>
            <p className="text-sm break-all">
              Secret: <code className="text-xs">{secret}</code>
            </p>
            {otpauthUrl ? (
              <p className="text-xs text-muted-foreground break-all">{otpauthUrl}</p>
            ) : null}
            {recoveryCodes.length > 0 ? (
              <div className="rounded-md border border-border p-2 text-xs">
                <p className="font-medium mb-1">Recovery codes (store offline)</p>
                <ul className="font-mono space-y-0.5">
                  {recoveryCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mfa-confirm">Confirm code</Label>
              <Input
                id="mfa-confirm"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </div>
            <Button type="button" disabled={busy} onClick={() => void confirm()}>
              Confirm MFA
            </Button>
          </>
        ) : enabled ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mfa-disable">Code to disable</Label>
              <Input
                id="mfa-disable"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456 or recovery code"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy || required}
              onClick={() => void turnOff()}
            >
              Disable MFA
            </Button>
          </>
        ) : (
          <Button type="button" disabled={busy} onClick={() => void startEnroll()}>
            Enroll authenticator
          </Button>
        )}
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
      /* still clear local session below */
    }
    await refresh();
    window.location.assign("/");
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
        description="Account, appearance, and session settings."
      />
      <div className="flex flex-col gap-4">
        <AccountCard />
        <MfaCard />
        <SubscriptionCard />
        <AppearanceCard />
        <SessionCard />
      </div>
    </Page>
  );
}
