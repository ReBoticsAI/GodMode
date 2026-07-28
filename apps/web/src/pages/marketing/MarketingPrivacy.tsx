import { Link } from "react-router-dom";
import { MarketingProse, MARKETING_BASE } from "./MarketingLayout";

export default function MarketingPrivacy() {
  return (
    <MarketingProse
      title="Privacy Policy"
      description="Effective 2026-07-18 · Operator: ReBotics / GodMode"
    >
      <h2>What we collect (GodMode Cloud)</h2>
      <ul>
        <li>
          Your account email, display name, and sign-in secrets (passwords are stored hashed;
          platform admins must use app-based two-factor authentication; other accounts may
          enable it when available).
        </li>
        <li>Billing IDs from Stripe so we can manage your subscription.</li>
        <li>
          The workspace content you create in Cloud (wiki, tasks, calendar, agents, and so on).
        </li>
        <li>Operational logs we need to run and secure the service (kept in our own systems).</li>
      </ul>
      <h2>Self-hosted</h2>
      <p>
        If you run GodMode on your own computer or server, your data stays there. We do not
        receive your workspace contents unless you choose to connect an outside service.
      </p>
      <h2>Services we use</h2>
      <p>
        Cloud may use Stripe for payments and Resend or SMTP for email such as verification and
        password reset. Marketplace payouts may use Stripe Connect, PayPal, or crypto options
        a seller configures. We do not depend on a third-party monitoring product for core
        logging.
      </p>
      <h2>Retention &amp; deletion</h2>
      <p>
        We keep account and billing records as needed to operate the service and meet legal
        duties. Email{" "}
        <a href="mailto:support@godmode.software">support@godmode.software</a> to request
        account deletion; payment records may still be retained where the law requires it.
      </p>
      <h2>Contact</h2>
      <p>
        Privacy questions:{" "}
        <a href="mailto:support@godmode.software">support@godmode.software</a> or{" "}
        <Link to={`${MARKETING_BASE}/contact`}>Contact</Link>.
      </p>
    </MarketingProse>
  );
}
