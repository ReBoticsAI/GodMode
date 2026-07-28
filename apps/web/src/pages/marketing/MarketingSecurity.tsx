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
        use pay-first signup, email verification, admin MFA, and durable rate limits.
      </p>
      <ul>
        <li>Per-tenant SQLite isolation for workspace data</li>
        <li>HttpOnly session cookies; HTTPS Secure flag in production</li>
        <li>
          Transactional auth email (verify and password reset) via Resend or SMTP in
          production
        </li>
        <li>
          Platform admins must enroll TOTP MFA before using the product shell; Admin APIs
          return MFA_REQUIRED until enrolled
        </li>
        <li>Optional Google / GitHub sign-in when configured</li>
        <li>
          On Cloud, agent coding runs in per-tenant workspaces with OS sandboxing
          (bubblewrap), network controls, and optional ephemeral build isolation. Not
          VM-grade isolation.
        </li>
        <li>
          Cloud blocks arbitrary Local plugin folder registration by default; Official and
          Community Marketplace installs are the supported commerce path
        </li>
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
