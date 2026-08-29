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
const privacyAccordionTriggerClass =
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

export default function MarketingPrivacy() {
  return (
    <MarketingProse
      title="Privacy Policy"
      description="Effective 2026-07-28 · Operator: ReBotics AI · Governing law: Saskatchewan, Canada"
    >
      <p>
        This Privacy Policy explains how <strong>ReBotics AI</strong> (&quot;we&quot;,
        &quot;us&quot;, or &quot;ReBotics&quot;) handles information in connection with
        GodMode open-source software (desktop, clone-the-repo, private hub, and Docker
        self-host) and GodMode Cloud (hosted SaaS), including related Marketplace features.
        Part A and Part B are separate. Related:{" "}
        <Link to={`${MARKETING_BASE}/terms`}>Terms of Service</Link> and{" "}
        <Link to={`${MARKETING_BASE}/refund`}>Refund policy</Link>.
      </p>
      <p>
        Expand any section for the full text. The short summary under each heading is plain
        language only. This page is not legal advice.
      </p>

      <Accordion multiple className="mt-2 border-t">
        <AccordionItem value="overview">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Overview / who we are"
              overview="ReBotics AI operates GodMode. Cloud is hosted by us. No third-party marketing analytics in core as shipped; first-party ops logs and optional platform/plugin metrics may exist."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                <strong>ReBotics AI</strong> is the operator of the GodMode product and GodMode
                Cloud. Contact for privacy and account matters:{" "}
                <a href="mailto:support@godmode.software">support@godmode.software</a>.
              </p>
              <p>
                This Policy covers personal information and related account or usage data we
                process when you use GodMode Cloud or interact with us (for example support
                email). It also explains what we do <strong>not</strong> receive when you run
                Part A software on your own machines.
              </p>
              <p>
                We do <strong>not sell</strong> personal information. We do not use
                third-party marketing or advertising analytics products (for example
                PostHog or Google Analytics) in core GodMode as shipped. We do collect
                first-party operational logs and may store platform or plugin metrics in
                GodMode databases when those features are enabled. See Logs, metrics, and
                analytics under Part B.
              </p>
              <p>
                This Policy is governed by the laws of the Province of{" "}
                <strong>Saskatchewan</strong> and the federal laws of <strong>Canada</strong>{" "}
                applicable therein, consistent with our{" "}
                <Link to={`${MARKETING_BASE}/terms`}>Terms of Service</Link>.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="part-a">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Part A: Local / OSS / desktop"
              overview="Desktop, clone-the-repo, private hub, and Docker keep workspace data on your machine or your deployment. ReBotics does not host that data unless you use Cloud."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                <strong>Part A</strong> applies to GodMode distributed as open-source and
                self-operated software, including desktop applications, cloning or forking the
                public repository, running a private hub, and Docker or similar deployments on
                infrastructure you control.
              </p>
              <p>
                For Part A, <strong>you</strong> are the operator of the deployment. Account
                records, workspace content, agent chats, secrets, and logs typically stay on
                systems you control. ReBotics AI does not receive your workspace contents from
                Part A alone.
              </p>
              <p>
                You may still choose to send data outside your deployment (for example BYOK
                calls to an LLM provider you configure, OAuth to a third party, or email to{" "}
                <a href="mailto:support@godmode.software">support@godmode.software</a>). Those
                transfers are under your configuration and the third party&apos;s terms, not
                GodMode Cloud hosting.
              </p>
              <p>
                Telemetry or analytics that run entirely inside your deployment (for example
                first-party operational metrics stored in your databases) are under your
                control. They are not a ReBotics Cloud collection channel.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="part-b">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Part B: Cloud: what we collect"
              overview="Cloud may hold account details, Stripe billing IDs, workspace content, agent and chat data, Marketplace records, transactional support mail, operational logs, and first-party platform or plugin metrics when enabled."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                <strong>Part B</strong> applies only when you use GodMode Cloud, the hosted
                multi-tenant SaaS operated by ReBotics AI. Categories below describe what we
                may process, depending on features you use.
              </p>

              <h3>Account</h3>
              <ul>
                <li>Email address and display name.</li>
                <li>
                  Password credentials (stored hashed; we do not store plaintext passwords).
                </li>
                <li>
                  Email verification and password-reset tokens as needed for those flows.
                </li>
                <li>
                  Optional <strong>Google</strong> OAuth for Cloud sign-in when configured
                  (provider account identifiers and profile fields Google returns for login).
                </li>
                <li>
                  Optional <strong>GitHub</strong> OAuth primarily to <strong>connect</strong>{" "}
                  GitHub for related product features (for example Tasks sync). Where also
                  configured for login, GitHub may create or link an account using profile
                  fields GitHub returns.
                </li>
                <li>
                  Multi-factor authentication data where enabled (platform admins are required
                  to use app-based TOTP MFA; other accounts may enable MFA when available).
                </li>
                <li>Session identifiers used to keep you signed in.</li>
              </ul>

              <h3>Billing</h3>
              <ul>
                <li>
                  Stripe customer, Checkout session, and related subscription or entitlement
                  identifiers so we can manage paid Cloud access.
                </li>
                <li>
                  Email associated with a Checkout entitlement when you subscribe before or
                  during signup.
                </li>
                <li>
                  Card and full payment instrument details are handled by Stripe (or a
                  successor processor we configure). We do not store full card numbers on
                  GodMode servers.
                </li>
              </ul>

              <h3>Workspace content</h3>
              <p>
                Content you create or import in Cloud under your account or tenant, which may
                include (without limitation) wiki pages, tasks, calendar items, notes, files
                under tenant workspaces, agent configurations, chat and agent transcripts, and
                similar product data. You decide what to put in Cloud. Do not put data in Cloud
                that you are not willing to store on a hosted service.
              </p>

              <h3>Agent and inference</h3>
              <ul>
                <li>
                  Cloud may store agent settings, tool audit or authority records, and chat or
                  agent message history needed to operate Intelligence, Digital You, and
                  related features.
                </li>
                <li>
                  <strong>BYOK (bring your own key):</strong> when you configure third-party
                  LLM or inference provider API keys and endpoints, prompts, tool context, and
                  related content may be forwarded to those providers to complete requests.
                  Provider processing is subject to that provider&apos;s terms and privacy
                  policy.
                </li>
                <li>
                  <strong>GodMode Inference:</strong> when offered as a live product feature,
                  prompts and related request context may be processed on ReBotics-operated
                  inference infrastructure for that path. Until GodMode Inference is live for
                  your tenant, assume Cloud AI calls use keys and endpoints you configure,
                  plus any local or platform models enabled for your tenant.
                </li>
              </ul>

              <h3>Marketplace</h3>
              <ul>
                <li>
                  Purchase and order records, entitlements, and Marketplace Terms acceptance
                  version.
                </li>
                <li>
                  Seller onboarding and payout connection data as configured (for example
                  Stripe Connect account id, PayPal merchant id, or crypto wallet address).
                </li>
                <li>
                  Ban or dispute-related records when Marketplace enforcement applies (see{" "}
                  <Link to={`${MARKETING_BASE}/terms`}>Terms</Link>).
                </li>
              </ul>

              <h3>Support and communications</h3>
              <ul>
                <li>
                  Emails you send to{" "}
                  <a href="mailto:support@godmode.software">support@godmode.software</a>, and
                  transactional mail we send (email verification, password reset, and
                  essential account or billing notices when applicable) via Resend or SMTP as
                  configured.
                </li>
                <li>
                  We do <strong>not</strong> maintain marketing email lists or send promotional
                  newsletters. Product announcements and similar updates are delivered through{" "}
                  <strong>in-app notifications</strong> when that feature is available.
                </li>
                <li>
                  In-app Support tickets or related hub records when you use those features.
                </li>
              </ul>

              <h3>Logs, metrics, and analytics</h3>
              <ul>
                <li>
                  First-party operational logs (for example request method, path, status,
                  timing, approximate IP such as Cloudflare connecting IP when present, user
                  id, and error text) used to run, debug, and secure Cloud. Warn and error
                  rows may be persisted in the host Cloud database (for example{" "}
                  <code className="text-foreground">platform_request_log</code>).
                </li>
                <li>
                  Rate-limit and abuse-prevention signals.
                </li>
                <li>
                  Platform and plugin metrics may be stored in first-party GodMode databases
                  or Workspace analytics stores (for example DuckDB-backed platform
                  analytics) when Cloud or a plugin enables that telemetry. That is operational
                  and product metrics under our (or your Part A) control, not a third-party
                  marketing analytics suite.
                </li>
                <li>
                  We do not claim that GodMode never collects analytics. We do claim that core
                  as shipped does not embed third-party marketing analytics SDKs for ads or
                  growth attribution.
                </li>
              </ul>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="use">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="How we use data"
              overview="We use Cloud data to provide the service, bill subscriptions, secure the platform, support you, and meet legal duties. Model training on workspace content will not begin until opt-in/out controls exist; PII and Digital You stay excluded."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>We use information described in Part B to:</p>
              <ul>
                <li>Provide, operate, maintain, and improve GodMode Cloud and Marketplace.</li>
                <li>Authenticate users, verify email, reset passwords, and manage sessions.</li>
                <li>Process payments, entitlements, renewals, and seller payouts via processors.</li>
                <li>
                  Deliver transactional email and in-app notifications, and respond to support
                  requests. We do not use your email for marketing lists.
                </li>
                <li>
                  Detect, investigate, and mitigate abuse, fraud, security incidents, and Terms
                  violations (including suspension or termination as described in the{" "}
                  <Link to={`${MARKETING_BASE}/terms`}>Terms</Link>).
                </li>
                <li>Comply with law, enforce agreements, and protect rights and safety.</li>
              </ul>
              <p>
                We do <strong>not sell</strong> personal information.
              </p>
              <h3>Model training (current and future)</h3>
              <p>
                <strong>Today:</strong> we do not currently operate public foundation-model
                training on your Cloud workspace content, and we are not training models on
                your workspace content as a shipped product behavior.
              </p>
              <p>
                <strong>Future:</strong> we may use <strong>non-PII</strong>,{" "}
                <strong>non-Digital You</strong> operational or product data to improve
                GodMode-operated models. We will <strong>not</strong> use personal information
                (PII) or anything related to the <strong>Digital You</strong> agent (including
                Digital You memory and persona data) for model training.
              </p>
              <p>
                Training on workspace content will <strong>not</strong> begin until opt-in /
                opt-out controls exist for the relevant data domains. Roadmap work is tracked
                publicly in GitHub issue{" "}
                <a
                  href="https://github.com/ReBoticsAI/GodMode/issues/208"
                  target="_blank"
                  rel="noreferrer"
                >
                  #208
                </a>
                . Until those controls ship, we will not use your workspace content for
                training.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="sharing">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Sharing"
              overview="We share data with processors needed to run Cloud: payments, email, edge infrastructure, and LLM providers you (or we) configure. Not for sale."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                We share information only as needed to operate the service, with your
                direction, or as required by law. Categories of recipients include:
              </p>
              <ul>
                <li>
                  <strong>Stripe</strong> (and related Stripe products such as Checkout,
                  Customer Portal, Connect, and webhooks) for Cloud billing and Marketplace
                  card payments / seller Connect where configured.
                </li>
                <li>
                  <strong>PayPal</strong> and crypto / wallet rails (for example MetaMask-
                  compatible flows) where Marketplace buyers or sellers use those methods.
                </li>
                <li>
                  <strong>Resend</strong> or an SMTP provider you or we configure for
                  transactional email only (verification, password reset, and essential account
                  or billing notices). Not for marketing lists.
                </li>
                <li>
                  <strong>Cloudflare</strong> (or equivalent edge / WAF / DNS / CDN) in front
                  of production Cloud hosts. Edge providers may process IP addresses, request
                  metadata, and similar network data as part of delivering and protecting the
                  service.
                </li>
                <li>
                  <strong>LLM and inference providers</strong> in two categories: (1){" "}
                  <strong>BYOK / provider forwarding</strong>, where content necessary for a
                  request may be sent to third-party model endpoints you configure; and (2){" "}
                  <strong>GodMode Inference</strong>, when that ReBotics-operated path is live
                  for your tenant.
                </li>
                <li>
                  <strong>OAuth providers:</strong> <strong>Google</strong> for Cloud sign-in
                  when configured; <strong>GitHub</strong> primarily to connect GitHub for
                  related features (and for login where that option is also configured).
                </li>
                <li>
                  Professional advisers, hosting or infrastructure vendors strictly as needed
                  to operate or defend the service, under confidentiality where appropriate.
                </li>
                <li>
                  Authorities when we believe disclosure is required by law or to protect
                  rights, safety, or the platform.
                </li>
              </ul>
              <p>
                Community Marketplace transactions may also involve the seller and the payment
                processor as parties to the purchase. See the Marketplace section of the{" "}
                <Link to={`${MARKETING_BASE}/terms`}>Terms</Link> and the{" "}
                <Link to={`${MARKETING_BASE}/refund`}>Refund policy</Link>.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="retention">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Retention and deletion"
              overview="Email support@godmode.software to request Cloud account or workspace deletion. No fixed deletion SLA. Payment records may be kept where required. Do not rely on Cloud as your only backup."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                We keep account, billing, Marketplace, log, and workspace data as needed to
                operate Cloud, handle disputes, and meet legal retention duties. Retention
                periods are not fixed product SLAs. If a Cloud subscription becomes past due,
                access continues for a seven (7) day grace period from the first past-due mark,
                then may be revoked until payment succeeds; that does not by itself delete your
                workspace.
              </p>
              <p>
                You may email{" "}
                <a href="mailto:support@godmode.software">support@godmode.software</a> to
                request deletion of your Cloud account or workspace data. We will attempt to
                process reasonable deletion requests, subject to legal retention needs (for
                example payment and tax records).
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
                ). Do not rely on Cloud as your sole backup. Deletion requests do not create
                refund rights; see the{" "}
                <Link to={`${MARKETING_BASE}/refund`}>Refund policy</Link> and{" "}
                <Link to={`${MARKETING_BASE}/terms`}>Terms</Link>.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="cookies">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Cookies / local storage / similar tech"
              overview="We use session cookies for sign-in and browser storage for app preferences. Not third-party ad trackers."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                GodMode Cloud uses an HttpOnly session cookie (for example{" "}
                <code className="text-foreground">godmode_session</code>) to keep you
                authenticated. Cookies are marked <code className="text-foreground">Secure</code>{" "}
                when the public URL is HTTPS. Mutating API calls from cookie sessions use
                trusted origin checks as part of CSRF defense.
              </p>
              <p>
                The web app may also use browser <strong>localStorage</strong> or{" "}
                <strong>sessionStorage</strong> for client preferences and temporary client
                state (for example selected tenant, UI layout, or checkout session handoff).
                That storage stays in your browser unless you clear it.
              </p>
              <p>
                We do not use third-party advertising cookies or marketing-analytics SDKs in
                core GodMode as shipped. First-party session and preference storage, plus
                operational metrics described under Part B, still apply. Edge providers (such
                as Cloudflare) may set or use their own cookies or similar technologies as
                part of network security and delivery; see that provider&apos;s documentation.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="security">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Security"
              overview="We apply reasonable security practices and continuous hardening. That is not a warranty or guarantee against incidents. Consistent with the Terms."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                We apply reasonable security practices and continuous hardening to GodMode
                Cloud as we judge appropriate for a shared hosted product (authentication,
                session handling, tenant isolation engineering, edge protection, backups, and
                related controls). Details for operators appear in our public security docs.
              </p>
              <p>
                That effort is <strong>not</strong> a guarantee of uninterrupted service,
                confidentiality, integrity, availability, or freedom from vulnerabilities,
                breaches, or data loss. GodMode Cloud is provided as is and at your own risk,
                with liability terms as stated in the{" "}
                <Link to={`${MARKETING_BASE}/terms`}>Terms of Service</Link>. See also{" "}
                <Link to={`${MARKETING_BASE}/security`}>Security</Link>.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="children">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Children's privacy"
              overview="Cloud accounts are not for children under 13. You are responsible for content you store. We do not police all user content; we may suspend or delete an account used by a child under 13 on notice."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                GodMode Cloud accounts are not directed at children under{" "}
                <strong>13</strong>. You must be at least 13 (or the higher age required in
                your jurisdiction, with parental consent where required) to create or use a
                Cloud account.
              </p>
              <p>
                We do not knowingly collect personal information from children under 13 for
                marketing. If we learn that a Cloud account is used by a child under 13, we
                may suspend or delete the account after notice to{" "}
                <a href="mailto:support@godmode.software">support@godmode.software</a>, and
                take reasonable steps to delete personal information we hold for that account
                where appropriate.
              </p>
              <p>
                <strong>You are responsible</strong> for content you create or store in
                GodMode (including wiki pages, notes, Digital You memory, agent data, and
                uploads). That includes not uploading children&apos;s personal information
                unlawfully. We do <strong>not</strong> claim to review or police all user
                content for child-related or inappropriate material.
              </p>
              <p>
                If you are in a jurisdiction that requires a higher age for online services,
                you must meet that age (or have appropriate parental consent) before using
                Cloud.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="choices">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Your choices / contact"
              overview="Email support@godmode.software for access, correction, or deletion requests. Canadian/Saskatchewan context; no automated GDPR portal."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                Subject to applicable law (including Canadian privacy expectations for an
                organization operating from Saskatchewan, Canada), you may email{" "}
                <a href="mailto:support@godmode.software">support@godmode.software</a> to
                request access to, correction of, or deletion of personal information we hold
                about you in Cloud, or to ask a privacy question. We will respond within a
                reasonable time. We may need to verify your identity and may retain certain
                records where law requires.
              </p>
              <p>
                We do not currently provide a self-serve automated privacy rights portal or
                European-style GDPR request tooling. Requests are handled by email.
              </p>
              <p>
                You can cancel Cloud billing in the Stripe Customer Portal (or equivalent).
                Canceling stops future renewals; it does not by itself delete data or create a
                refund. See{" "}
                <Link to={`${MARKETING_BASE}/refund`}>Refund policy</Link> and{" "}
                <Link to={`${MARKETING_BASE}/contact`}>Contact</Link>.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="changes">
          <AccordionTrigger className={privacyAccordionTriggerClass}>
            <SectionTrigger
              title="Changes to this policy"
              overview="We may update this Policy. The effective date above is authoritative for this published version."
            />
          </AccordionTrigger>
          <AccordionContent className="text-base">
            <LegalBlock>
              <p>
                We may update this Privacy Policy from time to time. The effective date at the
                top of this page is authoritative for the published version. Continued use of
                GodMode Cloud after a published update constitutes acceptance of the updated
                Policy, except where mandatory law requires a different process.
              </p>
              <p>
                Material changes that affect how we process Cloud personal information will be
                reflected on this page. Check back periodically if you use Cloud.
              </p>
            </LegalBlock>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <p className="mt-4">
        This Privacy Policy describes our product practices; it is not a substitute for
        independent legal advice.
      </p>
    </MarketingProse>
  );
}
