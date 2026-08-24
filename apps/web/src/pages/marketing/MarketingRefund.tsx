import { Link } from "react-router-dom";
import { MarketingProse, MARKETING_BASE } from "./MarketingLayout";

export default function MarketingRefund() {
  return (
    <MarketingProse
      title="Refund policy"
      description="Effective 2026-07-28 · Cloud, Seller, and Official sales are final; Community disputes are party/processor"
    >
      <p>
        This page states the refund rules for <strong>GodMode Cloud</strong> (hosted SaaS),{" "}
        <strong>GodMode Seller</strong> (Marketplace Sell seat), and the{" "}
        <strong>Marketplace</strong> (Official and Community digital packs). Self-hosted
        open-source software, desktop apps, private hub, and Docker installs are free and
        are not paid purchases. Operator: <strong>ReBotics AI</strong>.
      </p>

      <h2>No refunds (Cloud, Seller, and Official)</h2>
      <p>
        <strong>
          GodMode Cloud subscriptions, GodMode Seller subscriptions, and Official Marketplace
          sales are final. There are no refunds
        </strong>{" "}
        and no liability for paid Cloud access, Seller seats, or Official catalog digital
        goods. That includes change of mind, unused time, dissatisfaction, feature gaps,
        outages, data loss, agent behavior, security incidents, and delivered Official
        Marketplace items.
      </p>
      <p>
        Open-source desktop and self-host options exist so you can evaluate GodMode without
        paying. Cloud is convenience hosting only. Seller is a commerce seat only. Paying
        does not purchase refund rights. Details and liability terms:{" "}
        <Link to={`${MARKETING_BASE}/terms`}>Terms of Service</Link>.
      </p>

      <h2>GodMode Cloud and GodMode Seller</h2>
      <p>
        Cloud and Seller subscription payments are non-refundable. Plans renew until you
        cancel in the Stripe Customer Portal (or equivalent billing portal). Canceling stops
        future renewals; it does not refund the current paid period. Seller does not include
        a full Cloud workspace; the no-refund rule still applies.
      </p>

      <h2>Marketplace digital goods</h2>
      <p>
        Marketplace items are software (packs, plugins, and related digital content). Once
        payment succeeds and the item is delivered or install entitlement is granted, you
        have usable software.
      </p>
      <p>
        <strong>Official</strong> catalog items are sold by the platform (revenue to ReBotics
        AI). There are no refunds for delivered Official digital goods.
      </p>
      <p>
        <strong>Community</strong> listings are buyer-to-seller with a 10% platform fee. The
        payment goes through the payment processor. Disputes about the purchase are between
        the two transacting parties (buyer and seller), including through the processor&apos;s
        dispute tools where available. GodMode is not the seller of Community listings and
        does not mediate ordinary buyer/seller disagreements.
      </p>
      <p>
        <strong>Exception:</strong> if you paid but GodMode did not register the transaction
        to grant access or deliver the purchased software, email{" "}
        <a href="mailto:support@godmode.software">support@godmode.software</a> with details
        (account email, approximate payment date, item, and any payment reference). We will
        look into it. That path is for failed access provisioning only. It does not create a
        general right to a refund for delivered Community goods, or for Cloud, Seller, or
        Official sales.
      </p>
      <p>
        Chargebacks or payment disputes after delivery may result in a permanent Marketplace
        ban (buy and sell). Full Marketplace terms are inline in the{" "}
        <Link to={`${MARKETING_BASE}/terms`}>Terms of Service</Link>.
      </p>

      <h2>Billing questions</h2>
      <p>
        For billing questions, email{" "}
        <a href="mailto:support@godmode.software">support@godmode.software</a> (or use{" "}
        <Link to={`${MARKETING_BASE}/contact`}>Contact</Link>) with your account email and
        approximate payment date. Contacting support does not create a right to a refund,
        except for the Community failed-provisioning path above.
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
