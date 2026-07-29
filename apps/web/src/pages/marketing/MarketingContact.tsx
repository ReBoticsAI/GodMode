import { MarketingProse } from "./MarketingLayout";

export default function MarketingContact() {
  return (
    <MarketingProse
      title="Contact"
      description="Reach us by email. There is no contact form on this page."
    >
      <h2>Email</h2>
      <p>
        Write to{" "}
        <a href="mailto:support@godmode.software">support@godmode.software</a>. That is the
        address for product questions, GodMode Cloud billing, privacy requests, and security
        reports.
      </p>

      <h2>Cloud customers</h2>
      <p>
        If you are already signed in to Cloud, you can also open{" "}
        <strong>Support</strong> inside the app for hub tickets. Email still works anytime.
      </p>

      <h2>Security</h2>
      <p>
        Prefer a private report. Email support with enough detail to reproduce, or use{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode/security"
          target="_blank"
          rel="noreferrer"
        >
          GitHub private security advisories
        </a>
        . Please do not open a public issue for a vulnerability.
      </p>

      <h2>Developers and self-hosters</h2>
      <p>
        Docs, issues, and source live on{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode"
          target="_blank"
          rel="noreferrer"
        >
          github.com/ReBoticsAI/GodMode
        </a>
        . Use GitHub for open-source bugs and contributions; use email for account, billing,
        and private security matters.
      </p>
    </MarketingProse>
  );
}
