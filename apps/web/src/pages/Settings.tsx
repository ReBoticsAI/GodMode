import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  FolderGit2Icon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SparklesIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";
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
  disconnectGithubIntegration,
  fetchGithubIntegrationStatus,
  fetchMfaStatus,
  logoutAuth,
  startGithubIntegrationConnect,
} from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { USERS_PATH } from "@/lib/navigation";
import { SubscriptionCard } from "@/components/settings/SubscriptionCard";
import { WorkspaceDataCard } from "@/components/settings/WorkspaceDataCard";
import { OtpauthQr } from "@/components/auth/OtpauthQr";
import { useOnboardingWizardControl } from "@/components/FirstRunWizard";
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

function OnboardingCard() {
  const control = useOnboardingWizardControl();
  const [busy, setBusy] = useState(false);

  const reopen = async () => {
    if (!control) {
      toast.error("Onboarding is not available right now");
      return;
    }
    setBusy(true);
    try {
      await control.reopenWizard();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Setup wizard</CardTitle>
        <CardDescription>
          Reopen the first-run wizard to connect an LLM key or review setup tips.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" disabled={busy || !control} onClick={() => void reopen()}>
          <SparklesIcon data-icon="inline-start" />
          Reopen onboarding wizard
        </Button>
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
      toast.message("Scan the QR code, then confirm with a 6-digit code");
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
            {otpauthUrl ? <OtpauthQr otpauthUrl={otpauthUrl} /> : null}
            <p className="text-sm break-all">
              Or enter secret: <code className="text-xs">{secret}</code>
            </p>
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

function GithubConnectCard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    connected: boolean;
    login: string | null;
    configured: boolean;
    githubApp?: boolean;
    installationId?: number | null;
    installUrl?: string | null;
  } | null>(null);

  const reload = () => {
    void fetchGithubIntegrationStatus()
      .then(setStatus)
      .catch(() => {
        // Do not treat auth/routing failures as "OAuth not configured".
        setStatus(null);
      });
  };

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    const flag = searchParams.get("github");
    if (!flag) return;
    if (flag === "connected") {
      toast.success("GitHub connected");
      reload();
    } else if (flag === "error") {
      toast.error("GitHub connection failed");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("github");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await startGithubIntegrationConnect();
      window.location.assign(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start OAuth");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectGithubIntegration();
      toast.success("GitHub disconnected");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect GitHub</CardTitle>
        <CardDescription>
          One GitHub App connection for Projects sync (and the same App powers
          sign-in on this host). Install on the account that owns your Projects.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status?.connected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Connected as{" "}
              <span className="font-medium text-foreground">
                {status.login ?? "GitHub user"}
              </span>
              {status.installationId
                ? ` (install #${status.installationId})`
                : null}
              . Open Tasks → Board settings to link a Project.
            </p>
            {!status.installationId ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  App install not detected yet. If the App is not installed on
                  the account that owns your Projects, install it first, then
                  reconnect.
                </p>
                <div className="flex flex-wrap gap-2">
                  {status.installUrl ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        window.open(
                          status.installUrl!,
                          "_blank",
                          "noopener,noreferrer"
                        );
                      }}
                    >
                      Install GodMode Cloud
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    disabled={busy || status.configured === false}
                    onClick={() => void connect()}
                  >
                    <FolderGit2Icon data-icon="inline-start" />
                    Connect again
                  </Button>
                </div>
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect GitHub
            </Button>
          </>
        ) : (
          <>
            {!status?.configured ? (
              <p className="text-sm text-muted-foreground">
                GitHub App is not configured on this host. Set{" "}
                <code className="text-xs">GITHUB_APP_*</code> (see Configuration)
                including private key path and webhook secret.
              </p>
            ) : null}
            <Button
              type="button"
              disabled={busy || status?.configured === false}
              onClick={() => void connect()}
            >
              <FolderGit2Icon data-icon="inline-start" />
              Connect GitHub
            </Button>
          </>
        )}
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
        <OnboardingCard />
        <MfaCard />
        <GithubConnectCard />
        <SubscriptionCard />
        <WorkspaceDataCard />
        <AppearanceCard />
        <SessionCard />
      </div>
    </Page>
  );
}
