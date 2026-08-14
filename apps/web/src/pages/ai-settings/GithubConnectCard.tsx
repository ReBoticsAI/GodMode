import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FolderGit2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  disconnectGithubIntegration,
  fetchGithubIntegrationStatus,
  startGithubIntegrationConnect,
} from "@/api";

/** Connect GitHub App for Projects sync (and Cloud sign-in when configured). */
export function GithubConnectCard() {
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
        <CardTitle className="flex items-center gap-2">
          <FolderGit2Icon className="size-4" />
          Connect GitHub
        </CardTitle>
        <CardDescription>
          One GitHub App connection for Projects sync, coding clone/push, pull
          requests, and GitHub Releases submit (draft-first). The same App powers
          sign-in on this host. Install on the account that owns your Projects and
          repos. Contents write is required for release create/publish.
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
              . Open Tasks → Board settings to link a Project. Coding agents use
              the same connection for github.com clone, push, pull requests, and
              release submit. Track status on Releases.
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
