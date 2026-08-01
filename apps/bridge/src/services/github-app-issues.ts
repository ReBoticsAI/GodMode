/**
 * Create a Core GitHub issue via the platform GitHub App installation.
 */
import {
  createInstallationAccessToken,
  githubAppConfigured,
  resolvePlatformInstallationId,
} from "./github-app.js";

export async function createCoreGithubIssue(opts: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<{ number: number; htmlUrl: string; nodeId: string }> {
  if (!githubAppConfigured()) {
    throw Object.assign(
      new Error("GitHub App is not configured on this host"),
      { status: 503 }
    );
  }
  const installationId = await resolvePlatformInstallationId();
  if (!installationId) {
    throw Object.assign(
      new Error(
        "Platform GitHub App installation not found. Install the App on ReBoticsAI and set GITHUB_APP_PLATFORM_INSTALLATION_ID if needed."
      ),
      { status: 503 }
    );
  }
  const { token } = await createInstallationAccessToken(installationId);
  const res = await fetch(
    "https://api.github.com/repos/ReBoticsAI/GodMode/issues",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "GodMode",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: opts.title.slice(0, 200),
        body: opts.body.slice(0, 60_000),
        labels: opts.labels,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Create GitHub issue failed (${res.status}): ${text.slice(0, 300)}`),
      { status: 502 }
    );
  }
  const json = (await res.json()) as {
    number: number;
    html_url: string;
    node_id: string;
  };
  return {
    number: json.number,
    htmlUrl: json.html_url,
    nodeId: json.node_id,
  };
}
