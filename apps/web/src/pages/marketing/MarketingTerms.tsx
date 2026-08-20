import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import {
  MarketingProse,
  MARKETING_BASE,
  marketingSectionDescriptionClass,
  marketingSectionTitleClass,
} from "./MarketingLayout";

/** Neutralize AccordionTrigger defaults (text-sm font-medium) for marketing scale. */
const termsAccordionTriggerClass =
  "items-start py-4 text-base font-normal hover:no-underline [&:hover>span>span:first-child]:underline";

function SectionTrigger({
  title,
  overview,
}: {
  title: string;
  overview: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1.5 pr-2 text-left">
      <span className={marketingSectionTitleClass}>{title}</span>
      <span
        className={cn(
          marketingSectionDescriptionClass,
          "max-w-none font-normal"
        )}
      >
        {overview}
      </span>
    </span>
  );
}

function LegalBlock({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 text-base leading-relaxed text-muted-foreground [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1 [&_strong]:text-foreground [&_ul]:my-2 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
      <p className="text-sm font-medium text-muted-foreground">
        Full legal text
      </p>
      {children}
    </div>
  );
}

export default function MarketingTerms() {
  return (
    <MarketingProse
      title="Terms of Service"
      description="Effective 2026-07-28 · Operator: ReBotics AI · Governing law: Saskatchewan, Canada"
    >
      <p>
        These Terms cover GodMode open-source software (desktop, clone-the-repo,
        private hub, and Docker self-host) and GodMode Cloud (hosted SaaS). Part A
        and Part B are separate.         Marketplace buying and selling is governed by the
        Marketplace terms inline below. Related:{" "}
        <Link to={`${MARKETING_BASE}/refund`}>Refund policy</Link> (Cloud and Official
        final; Community dispute routing) and{" "}
        <Link to={`${MARKETING_BASE}/privacy`}>Privacy</Link>.
      </p>
      <p>
        Expand any section for the full legal text. The short summary under each
        heading is plain language only.
      </p>

      <Accordion multiple className="mt-2 border-t">
        <AccordionItem value="overview">
          <AccordionTrigger className={termsAccordionTriggerClass}>
            <SectionTrigger
              title="Overview and acceptance"
              overview="Using GodMode software or GodMode Cloud means you accept these Terms. If you do not agree, do not use the product."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                These Terms of Service (&quot;Terms&quot;) are an agreement between you and{" "}
                <strong>ReBotics AI</strong> (&quot;we&quot;, &quot;us&quot;, or
                &quot;ReBotics&quot;) governing access to and use of GodMode software and
                related services, including GodMode Cloud and the GodMode Marketplace.
              </p>
              <p>
                By installing, running, cloning, deploying, signing up for, paying for, or
                otherwise using GodMode or GodMode Cloud, you accept these Terms. If you use
                GodMode on behalf of an organization, you represent that you have authority
                to bind that organization.
              </p>
              <p>
                We may update these Terms from time to time. The effective date above is
                authoritative for this published version. Continued use after a published
                update constitutes acceptance of the updated Terms, except where a specific
                feature (such as Marketplace) requires explicit re-acceptance of a versioned
                policy.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="part-a">
          <AccordionTrigger className={termsAccordionTriggerClass}>
            <SectionTrigger
              title="Part A: Open source / self-hosted / desktop"
              overview="Desktop apps, cloning the repo, private hub, and Docker are provided as-is, free of Cloud obligations. You operate them at your own risk."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                <strong>Part A</strong> applies to GodMode distributed as open-source and
                self-operated software, including (without limitation) desktop applications,
                cloning or forking the public repository, running a private hub, and Docker
                or similar container deployments on infrastructure you control.
              </p>
              <p>
                Part A software is provided <strong>as is</strong> and{" "}
                <strong>as available</strong>, for use <strong>at your own risk</strong>,
                under the applicable open-source license(s) in the repository. We make no
                warranties of any kind regarding Part A software, express or implied,
                including merchantability, fitness for a particular purpose, non-infringement,
                security, availability, or correctness.
              </p>
              <p>
                You are the operator of any Part A deployment. You are solely responsible for
                securing hosts, networks, credentials, backups, updates, plugins, agents, and
                data. GodMode Cloud (Part B) creates no support, uptime, backup, security, or
                compliance obligation for Part A deployments.
              </p>
              <p>
                We practice reasonable security engineering and continuous hardening for our
                own products and published code where we choose to invest effort. That practice
                is not a warranty, guarantee, SLA, or promise that any build, install, or
                configuration is safe, complete, or free of defects.
              </p>
              <p>
                To the maximum extent permitted by law, ReBotics AI has{" "}
                <strong>zero liability</strong> for Part A software, including any damages
                arising from use, misuse, agent actions, data loss, security incidents, or
                downtime on systems you operate.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="part-b">
          <AccordionTrigger className={termsAccordionTriggerClass}>
            <SectionTrigger
              title="Part B: GodMode Cloud (SaaS)"
              overview="Cloud is paid convenience hosting. No refunds. No warranties. $0 liability. You are responsible for agent actions under your account. We may suspend or terminate for abuse, non-payment, or security risk."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <h3>B1. Scope</h3>
              <p>
                <strong>Part B</strong> applies only to GodMode Cloud, the hosted multi-tenant
                SaaS operated by ReBotics AI. Part B does not convert Part A software into a
                managed service and does not create Cloud obligations for self-hosted or
                desktop use.
              </p>
              <p>
                Open-source desktop and self-host options are available without a Cloud
                subscription. Cloud is offered as convenience hosting only. Paying for Cloud
                does not purchase warranties, liability coverage, or refund rights.
              </p>

              <h3>B2. Accounts and acceptable use</h3>
              <p>
                You must provide accurate account information and keep credentials secure. You
                are responsible for all activity under your account, including actions taken by
                humans, integrations, automation, and <strong>agents</strong> running with your
                permissions or API keys.
              </p>
              <p>
                Do not abuse the service, attempt unauthorized access, disrupt other tenants,
                probe systems beyond authorized testing channels, or use Cloud for unlawful
                activity. We may investigate suspected abuse.
              </p>

              <h3>B3. Subscription and billing</h3>
              <p>
                Paid Cloud access is billed through Stripe (or successor processors we
                configure). Plans renew until you cancel in the billing portal. Canceling stops
                future renewals; it does not create a refund for the current paid period.
                Failure to pay may suspend or terminate access. Designated platform operators
                may be exempt from the paywall so we can operate the service.
              </p>

              <h3>B4. No refunds</h3>
              <p>
                <strong>All Cloud sales are final. There are no refunds</strong>, including for
                change of mind, unused time, dissatisfaction, feature gaps, outages, data loss,
                agent behavior, or security incidents. See the{" "}
                <Link to={`${MARKETING_BASE}/refund`}>Refund policy</Link>. If you want to
                evaluate GodMode without paying, use Part A (open source / self-hosted /
                desktop) first.
              </p>

              <h3>B5. Suspension and termination</h3>
              <p>
                We may suspend or terminate Cloud access, in whole or in part, for violation of
                these Terms, non-payment, chargebacks or payment disputes we deem abusive,
                security risk to the platform or other tenants, unlawful use, or operational
                necessity. We are not obligated to provide advance notice where doing so would
                increase risk or is impractical.
              </p>

              <h3>B6. Data deletion</h3>
              <p>
                You may email{" "}
                <a href="mailto:support@godmode.software">support@godmode.software</a> to
                request deletion of your Cloud account or workspace data. We will attempt to
                process reasonable deletion requests, subject to legal retention needs (for
                example payment records).
              </p>
              <p>
                Separately, we may delete account or workspace data during operational cleanup,
                inactivity handling, or infrastructure maintenance. There is{" "}
                <strong>no fixed retention or deletion SLA</strong>. Self-serve lifecycle and
                deletion tooling is incomplete; related work is tracked publicly (including
                GitHub issue{" "}
                <a
                  href="https://github.com/ReBoticsAI/GodMode/issues/207"
                  target="_blank"
                  rel="noreferrer"
                >
                  #207
                </a>
                ). Do not rely on Cloud as your sole backup.
              </p>

              <h3>B7. Agents</h3>
              <p>
                GodMode Cloud may let you run AI agents that read, write, execute, spend, or
                send on your behalf. <strong>You are solely responsible</strong> for agent
                configuration, permissions, prompts, tools, spend, and outcomes under your
                account. ReBotics AI is not responsible for agent actions, errors, or harm.
              </p>

              <h3>B8. Security practice (not a warranty)</h3>
              <p>
                We apply reasonable security practices and continuous hardening to GodMode
                Cloud as we judge appropriate for a shared hosted product. That effort is not
                a guarantee of uninterrupted service, confidentiality, integrity, availability,
                or freedom from vulnerabilities, breaches, or data loss.
              </p>

              <h3>B9. No warranties</h3>
              <p>
                GodMode Cloud is provided <strong>as is</strong> and{" "}
                <strong>as available</strong>, for use <strong>at your own risk</strong>. To
                the maximum extent permitted by law, we disclaim all warranties, express or
                implied, including merchantability, fitness for a particular purpose,
                non-infringement, quiet enjoyment, and any warranty arising from course of
                dealing or usage of trade. We do not warrant that Cloud will be error-free,
                secure, or available at any particular time.
              </p>

              <h3>B10. Liability cap: $0</h3>
              <p>
                To the maximum extent permitted by law, ReBotics AI&apos;s total liability
                arising out of or related to GodMode Cloud, these Terms, or your use of the
                service is <strong>$0 (zero)</strong>. We have no responsibility for any
                damages of any kind, including direct, indirect, incidental, special,
                consequential, exemplary, or punitive damages, or loss of profits, data,
                goodwill, or business opportunity, whether based in contract, tort (including
                negligence), strict liability, or otherwise, even if advised of the
                possibility.
              </p>
              <p>
                Rationale in plain terms: self-host and desktop are available free under Part
                A; Cloud is pure convenience. There are no refunds and no liability.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="marketplace">
          <AccordionTrigger className={termsAccordionTriggerClass}>
            <SectionTrigger
              title="Marketplace"
              overview="Official catalog: we sell, revenue to the platform, no refunds. Community: seller and buyer via the payment processor with a 10% platform cut; Stripe Connect sellers are merchant of record. Prohibited categories and Live Share pin duties apply. Chargebacks after delivery can permanently ban Marketplace access."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                The following Marketplace Terms apply to buying and selling on the GodMode
                Marketplace (Official catalog and Community / user listings). They supplement
                these Terms. SaaS Cloud subscription terms remain as in Part B.
              </p>
              <p>
                <strong>Version:</strong> 2 (product may override with{" "}
                <code className="text-foreground">MARKETPLACE_TOS_VERSION</code>). Using
                Marketplace buy or sell features requires accepting the current ToS version.
                Continued use after a ToS version bump requires re-acceptance.
              </p>

              <h3>Official vs Community</h3>
              <ul>
                <li>
                  <strong>Official</strong> ReBotics / GodMode catalog items: ReBotics AI (or
                  its designated merchant of record) sells the item; revenue is{" "}
                  <strong>100%</strong> to the platform.
                </li>
                <li>
                  <strong>Community</strong> (user) listings: the transaction is between seller
                  and buyer and settles through the payment processor. The platform takes a{" "}
                  <strong>10%</strong> fee; the remainder goes to the seller via their
                  connected payout rail (Stripe Connect, PayPal, or MetaMask, where
                  configured).
                </li>
              </ul>

              <h3>Stripe Connect (Community sellers)</h3>
              <p>
                When you sell Community listings with Stripe Connect checkout, you are the
                merchant of record for that charge. GodMode collects a 10% platform fee and
                remits the remainder to your connected Stripe account. You are responsible for
                listing accuracy, delivery or live access as advertised, tax and legal
                compliance, and buyer disputes routed to you as seller. GodMode may delist
                listings, freeze payouts, or ban Marketplace access for ToS violations,
                repeated disputes, or prohibited content. Before publishing or binding while
                Connect is linked, you must attest that your listings comply with the
                prohibited and restricted categories below.
              </p>

              <h3>Prohibited and restricted listings</h3>
              <p>
                Community listings must not offer goods, services, or content that Stripe or
                applicable law treat as prohibited or heavily restricted. Examples include
                gambling, adult sexual content, weapons or illegal goods, and clearly illegal
                activity such as fraud or malware. Sellers remain responsible for compliance.
              </p>

              <h3>Live Share catalog pin</h3>
              <p>
                Community Live Share requires a Community catalog entry with live delivery and
                a bound workspace resource whose export matches the pinned catalog bundle.
                Drift or a catalog pin bump demotes the listing until re-bind. Free Shared
                sidebar grants stay outside Marketplace.
              </p>

              <h3>Digital goods are final</h3>
              <p>
                Marketplace items are software (packs, plugins, and related digital content).
                Once payment succeeds and the item is delivered or install entitlement is
                granted, you have usable software.{" "}
                <strong>
                  There are no refunds for delivered Official digital goods.
                </strong>{" "}
                Delivered Community goods are likewise not refundable by GodMode; ordinary
                purchase disputes are between buyer and seller (and the payment processor
                where applicable). See Community disputes below.
              </p>

              <h3>Community disputes and failed provisioning</h3>
              <p>
                For Community purchases, disputes are between the two transacting parties
                (buyer and seller). GodMode is not the seller and does not mediate ordinary
                buyer/seller disagreements.
              </p>
              <p>
                Exception: if payment succeeded but GodMode did not register the transaction
                to grant access or deliver the purchased software, the buyer should email{" "}
                <a href="mailto:support@godmode.software">support@godmode.software</a> with
                details (account email, approximate payment date, item, and any payment
                reference). We will look into it. That path is for failed access
                provisioning only and does not create a general refund right, an SLA, or
                liability for delivered goods.
              </p>

              <h3>Chargebacks and disputes</h3>
              <p>
                If you reverse a payment via chargeback, payment dispute, or similar clawback
                after delivery:
              </p>
              <ul>
                <li>Your Marketplace access is permanently banned.</li>
                <li>You may not buy or earn (sell) on the Marketplace.</li>
                <li>
                  GodMode Cloud login (SaaS seat) may continue if your subscription is otherwise
                  valid.
                </li>
              </ul>
              <p>
                This policy exists because software cannot be practically returned once
                installed.
              </p>

              <h3>Payment methods</h3>
              <p>
                Buyers may pay with card (Stripe), PayPal, or crypto (MetaMask-compatible)
                where configured. Sellers must connect at least one payout method before
                publishing paid listings.
              </p>

              <h3>No Marketplace liability beyond platform fee collection</h3>
              <p>
                Community listings are seller-to-buyer transactions facilitated by the
                platform. To the maximum extent permitted by law, ReBotics AI has{" "}
                <strong>$0 liability</strong> for Marketplace purchases, listings, payouts,
                seller conduct, buyer conduct, or digital goods quality. Official catalog
                items remain subject to the same no-refund and $0 liability rules as Part B.
                The failed-provisioning support path above does not waive that cap or create
                a refund obligation.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="governing-law">
          <AccordionTrigger className={termsAccordionTriggerClass}>
            <SectionTrigger
              title="Governing law"
              overview="These Terms are governed by the laws of Saskatchewan, Canada."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                These Terms are governed by the laws of the Province of{" "}
                <strong>Saskatchewan</strong> and the federal laws of <strong>Canada</strong>{" "}
                applicable therein, without regard to conflict-of-law rules that would require
                another jurisdiction&apos;s law.
              </p>
              <p>
                Subject to mandatory consumer protections that cannot be waived, courts located
                in Saskatchewan, Canada, are the exclusive venue for disputes arising out of
                these Terms or the services, except that we may seek injunctive relief in any
                jurisdiction to protect our rights or the security of the platform.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="contact">
          <AccordionTrigger className={termsAccordionTriggerClass}>
            <SectionTrigger
              title="Contact"
              overview="Product, billing, deletion, and Terms questions go to support@godmode.software only."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                Contact:{" "}
                <a href="mailto:support@godmode.software">support@godmode.software</a>. That
                is the address for Terms questions, Cloud billing, deletion requests, and
                related account matters. See also{" "}
                <Link to={`${MARKETING_BASE}/contact`}>Contact</Link>.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <p className="mt-4">
        These Terms describe our product policies; they are not a substitute for independent
        legal advice.
      </p>
    </MarketingProse>
  );
}
