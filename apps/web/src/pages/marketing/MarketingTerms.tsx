import { Link } from "react-router-dom";
import { MarketingProse, MARKETING_BASE } from "./MarketingLayout";

export default function MarketingTerms() {
  return (
    <MarketingProse
      title="Terms of Service"
      description="Effective 2026-07-18 · Operator: ReBotics / GodMode"
    >
      <p>
        These Terms govern use of GodMode software (self-hosted) and GodMode Cloud (hosted
        SaaS). Marketplace buying and selling is also governed by the Marketplace Terms
        summarized below and in the product.
      </p>
      <h2>1. Accounts</h2>
      <p>
        You must provide accurate information and keep credentials secure. You are responsible
        for activity under your account. GodMode Cloud may require email verification and
        multi-factor authentication for administrators.
      </p>
      <h2>2. GodMode Cloud subscription</h2>
      <p>
        Paid Cloud access is billed via Stripe. Plans renew until canceled in the Customer
        Portal. Failure to pay may suspend access. Platform operators listed in INITIAL_ADMINS
        may be exempt from paywall for operations. Refunds are limited as described in the{" "}
        <Link to={`${MARKETING_BASE}/refund`}>Refund policy</Link>.
      </p>
      <h2>3. Acceptable use</h2>
      <p>
        Do not abuse the service, attempt unauthorized access, disrupt other tenants, or use
        the product for unlawful activity. We may suspend accounts that violate these Terms.
      </p>
      <h2>4. Marketplace</h2>
      <p>
        Digital Marketplace goods are final once delivered. Chargebacks after delivery may
        result in a permanent Marketplace ban. Official catalog revenue accrues to the
        platform; Community (user) listings take a 10% platform fee. See also{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode/blob/main/docs/MARKETPLACE_TOS.md"
          target="_blank"
          rel="noreferrer"
        >
          Marketplace Terms
        </a>{" "}
        in the open-source docs and the in-product acceptance flow.
      </p>
      <h2>5. Self-hosted software</h2>
      <p>
        Self-hosted builds are provided as-is under the project license. You are the operator
        of your deployment and responsible for securing it.
      </p>
      <h2>6. Disclaimers</h2>
      <p>
        The service is provided “as is” without warranties of uninterrupted availability. To
        the maximum extent permitted by law, liability is limited to fees paid in the three
        months preceding a claim.
      </p>
      <h2>7. Contact</h2>
      <p>
        Questions: see <Link to={`${MARKETING_BASE}/contact`}>Contact</Link>.
      </p>
    </MarketingProse>
  );
}
