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
        <li>Account email, display name, and authentication secrets (hashed passwords / MFA).</li>
        <li>Billing identifiers from Stripe (customer and subscription IDs).</li>
        <li>Workspace content you create in Cloud (wiki, tasks, calendar, agents, etc.).</li>
        <li>Operational logs needed to run and secure the service (first-party Bridge logs).</li>
      </ul>
      <h2>Self-hosted</h2>
      <p>
        If you run GodMode yourself, data stays on your infrastructure. ReBotics does not
        receive your workspace contents unless you intentionally connect outbound services.
      </p>
      <h2>Processors</h2>
      <p>
        Cloud may use Stripe for payments and Resend or SMTP for transactional email.
        Marketplace payouts may use Stripe Connect, PayPal, or crypto rails you configure.
        GodMode does not rely on third-party APM products for core logging.
      </p>
      <h2>Retention &amp; deletion</h2>
      <p>
        We retain account and billing records as required for operations and law. Contact us
        to request account deletion subject to legal retention of payment records.
      </p>
      <h2>Contact</h2>
      <p>
        Privacy requests: see <Link to={`${MARKETING_BASE}/contact`}>Contact</Link>.
      </p>
    </MarketingProse>
  );
}
