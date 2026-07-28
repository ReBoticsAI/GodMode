import { Link } from "react-router-dom";
import { MarketingProse, MARKETING_BASE } from "./MarketingLayout";

export default function MarketingSecurity() {
  return (
    <MarketingProse
      title="Security"
      description="How we protect GodMode Cloud, in plain language."
    >
      <p>
        GodMode is open source, so anyone can review how it works. On GodMode Cloud we still
        harden the live service: encrypted connections, locked-down servers, pay-before-signup
        for new accounts, email verification, and strong account protections for operators.
      </p>
      <p>What that means for you:</p>
      <ul>
        <li>
          Your Cloud workspace is kept separate from other customers. One account cannot read
          another account&apos;s data by design.
        </li>
        <li>
          Sign-in uses secure browser cookies over HTTPS. We send verification and password-reset
          mail through a dedicated email provider (or SMTP), not a personal inbox.
        </li>
        <li>
          Platform administrators must turn on app-based two-factor authentication before using
          the product.
        </li>
        <li>
          Optional Google or GitHub sign-in when we enable it for your environment.
        </li>
        <li>
          When AI agents write or run code on Cloud, that work happens in an isolated workspace
          with filesystem and network limits. It is strong sandboxing, not a full private
          virtual machine.
        </li>
        <li>
          On Cloud, add-ons come through the Marketplace (Official and Community). That keeps
          installs on a reviewed commerce path instead of arbitrary folders on our servers.
        </li>
        <li>Desktop updates can use signed release manifests. Cloud billing verifies Stripe webhooks.</li>
      </ul>
      <p>
        Found a vulnerability? Email{" "}
        <a href="mailto:support@godmode.software">support@godmode.software</a> or use{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode/security"
          target="_blank"
          rel="noreferrer"
        >
          GitHub private security advisories
        </a>
        . Please do not file a public issue. More detail for operators is in the{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode/blob/main/docs/SECURITY.md"
          target="_blank"
          rel="noreferrer"
        >
          SECURITY.md
        </a>{" "}
        on GitHub. Questions: <Link to={`${MARKETING_BASE}/contact`}>Contact</Link>.
      </p>
    </MarketingProse>
  );
}
