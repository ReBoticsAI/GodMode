import { Link } from "react-router-dom";
import { MarketingProse, MARKETING_BASE } from "./MarketingLayout";

export default function MarketingRefund() {
  return (
    <MarketingProse
      title="Refund policy"
      description="GodMode Cloud subscriptions and Marketplace digital goods"
    >
      <p>
        This page covers refunds for <strong>GodMode Cloud</strong> (hosted SaaS) and the{" "}
        <strong>Marketplace</strong> (Official and Community digital packs). Self-hosted
        open-source software is free and is not a paid purchase.
      </p>

      <h2>GodMode Cloud</h2>
      <p>
        All Cloud subscription sales are final. There are no refunds for change of mind,
        unused access, or dissatisfaction with the cloud service. If you want to evaluate
        GodMode without paying, use the free open-source / self-hosted install first.
      </p>
      <p>We will refund:</p>
      <ul>
        <li>Payment failures that still charged your payment method</li>
        <li>Duplicate charges for the same purchase</li>
        <li>Cases where an account was never provisioned after a successful payment</li>
      </ul>
      <p>
        Plans renew until you cancel in the Stripe Customer Portal (or equivalent billing
        portal). Canceling stops future renewals; it does not refund the current paid period.
      </p>

      <h2>Marketplace digital goods</h2>
      <p>
        Marketplace items are software (packs, plugins, and related digital content). Once
        payment succeeds and the item is delivered or install entitlement is granted, you
        have usable software. There are no refunds for delivered digital goods.
      </p>
      <p>
        Chargebacks or payment disputes after delivery may result in a permanent Marketplace
        ban (buy and sell). See the{" "}
        <a
          href="https://github.com/ReBoticsAI/GodMode/blob/main/docs/MARKETPLACE_TOS.md"
          target="_blank"
          rel="noreferrer"
        >
          Marketplace Terms
        </a>{" "}
        and the in-product acceptance flow.
      </p>

      <h2>How to request a covered refund</h2>
      <p>
        Contact us via <Link to={`${MARKETING_BASE}/contact`}>Contact</Link> with your
        account email, approximate payment date, and what went wrong (duplicate charge,
        failed provisioning, or similar). We use that to verify the payment and account
        state.
      </p>

      <h2>Related</h2>
      <ul>
        <li>
          <Link to={`${MARKETING_BASE}/terms`}>Terms of Service</Link>
        </li>
        <li>
          <Link to={`${MARKETING_BASE}/pricing`}>Pricing</Link>
        </li>
        <li>
          <Link to={`${MARKETING_BASE}/privacy`}>Privacy</Link>
        </li>
      </ul>
    </MarketingProse>
  );
}
