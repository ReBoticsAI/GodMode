import { Link } from "react-router-dom";
import { MarketingProse, MARKETING_BASE } from "./MarketingLayout";

export default function MarketingSecurity() {
  return (
    <MarketingProse
      title="Security"
      description="How GodMode Cloud protects your workspace, in plain language."
    >
      <p>
        GodMode is open source, so anyone can review how it works. GodMode Cloud still hardens
        the live service for shared hosting: encrypted connections, locked-down servers,
        pay-before-signup, email verification, and stronger defaults than a laptop install.
      </p>

      <h2>Accounts and access</h2>
      <ul>
        <li>
          New Cloud accounts start with <strong>choose a plan → pay → create account</strong>.
          That paywall is part of how we keep random signup noise off the shared host.
        </li>
        <li>
          Your account and workspace data are kept separate from other customers. One account
          cannot read another account&apos;s Platform Vault or workspace databases by design.
          Connect keys for your LLM providers live in your Platform Vault (per account), not in a
          shared platform pool.
        </li>
        <li>
          Sign-in uses secure browser cookies over HTTPS. Verification and password-reset mail
          go through a dedicated email provider (or SMTP), not a personal inbox.
        </li>
        <li>
          Platform administrators must enroll app-based two-factor authentication before they
          can use the product shell. Admin APIs stay blocked until that is done.
        </li>
        <li>
          Optional Google or GitHub sign-in when we enable it for the environment.
        </li>
      </ul>

      <h2>Agents that write and run code</h2>
      <ul>
        <li>
          On Cloud, agent coding is available in an isolated per-tenant workspace with
          filesystem and network limits (sandbox layers on the shared host). That is strong
          production-minded isolation, not a private virtual machine per customer.
        </li>
        <li>
          Operators can pause agents and cut off coding, spend, deploy, delete, and outbound
          automation sends with kill switches and quotas when something runs away.
        </li>
        <li>
          Builds that need a clean environment can run in short-lived containers managed by a
          host build supervisor, not by mounting the Docker socket into your tenant.
        </li>
      </ul>

      <h2>Extensions and updates</h2>
      <ul>
        <li>
          On Cloud, add-ons install through the Marketplace (Official and Community). Arbitrary
          Local plugin folders on our servers are blocked by default so installs stay on a
          consistent commerce path.
        </li>
        <li>
          Desktop and self-host updates can use signed release manifests. Cloud billing verifies
          Stripe webhook signatures.
        </li>
        <li>
          Production Cloud sits behind an edge proxy and origin firewall (Cloudflare in front of
          the VPS) with HTTPS end to end.
        </li>
      </ul>

      <h2>What we do not claim</h2>
      <ul>
        <li>
          Coding sandboxes are not bank-grade or Cursor Cloud VM isolation. Roadmap work may
          raise the ceiling later; Cloud today is Layers-style shared-host hardening.
        </li>
        <li>
          Self-host and desktop are first-class and open source, but you are the operator of
          that machine. Harden them if you expose them to the internet.
        </li>
        <li>
          We do not depend on a third-party monitoring product for core logging. Request and
          error visibility stays first-party in the product.
        </li>
      </ul>

      <h2>Report a vulnerability</h2>
      <p>
        Email{" "}
        <a href="mailto:support@godmode.software">support@godmode.software</a> or use{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode/security"
          target="_blank"
          rel="noreferrer"
        >
          GitHub private security advisories
        </a>
        . Please do not open a public issue for a security bug. Operators and self-hosters can
        read the full threat model in{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode/blob/main/docs/SECURITY.md"
          target="_blank"
          rel="noreferrer"
        >
          SECURITY.md
        </a>
        . Questions: <Link to={`${MARKETING_BASE}/contact`}>Contact</Link>.
      </p>
    </MarketingProse>
  );
}
