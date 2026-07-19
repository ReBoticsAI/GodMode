import { MarketingProse } from "./MarketingLayout";

export default function MarketingSecurity() {
  return (
    <MarketingProse
      title="Security"
      description="Open source threat model and Cloud production hardening overview."
    >
      <p>
        GodMode is open source. Assume attackers can read the codebase. Production Cloud
        deployments terminate TLS at Cloudflare, keep the Hostinger origin locked down, and
        use paywall signup, email verification, admin MFA, and durable rate limits.
      </p>
      <ul>
        <li>Per-tenant SQLite isolation for workspace data</li>
        <li>HttpOnly session cookies; HTTPS Secure flag in production</li>
        <li>Signed release manifests for updates</li>
        <li>Stripe webhook signature verification for Cloud billing</li>
        <li>First-party request/error logging in core SQLite (no third-party APM required)</li>
      </ul>
      <p>
        Report vulnerabilities via GitHub private security advisories. Do not open public
        issues for security bugs.
      </p>
    </MarketingProse>
  );
}
