import { MarketingProse } from "./MarketingLayout";

export default function MarketingContact() {
  return (
    <MarketingProse
      title="Contact"
      description="Questions, billing, and security reports for GodMode Cloud."
    >
      <p>
        Email us at{" "}
        <a href="mailto:support@godmode.software">support@godmode.software</a>. That covers
        product questions, Cloud billing, privacy requests, and security reports.
      </p>
      <p>
        If you are signed in to Cloud, you can also reach us from Support inside the app.
      </p>
      <p>
        For security issues, prefer a private report: email support with enough detail to
        reproduce, or use{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode/security"
          target="_blank"
          rel="noreferrer"
        >
          GitHub security advisories
        </a>
        . Please do not open a public issue for a vulnerability.
      </p>
      <p>
        Developers and self-hosters: full docs and source live on{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode"
          target="_blank"
          rel="noreferrer"
        >
          github.com/ReBoticsAI/GodMode
        </a>
        .
      </p>
    </MarketingProse>
  );
}
