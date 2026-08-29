import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  MARKETING_BASE,
  marketingCardClass,
  marketingCardDescriptionClass,
  marketingCardTitleClass,
  marketingPageDescriptionClass,
} from "./MarketingLayout";
import { CLOUD_APP_HOME } from "./cloudAppUrl";
import { marketingSelfHostedSellUrl } from "./marketingBase";

export default function MarketingPricing() {
  return (
    <Page>
      <PageHeader
        title="Pricing"
        description="Open-source GodMode on your machine or hosted in Cloud. Self-Hosted is free. Add a Seller seat to earn on the Community Marketplace while your data stays local. Full Cloud is the easiest way in from any device. Bring your own AI keys."
        descriptionClassName={marketingPageDescriptionClass}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className={marketingCardClass}>
          <CardHeader>
            <CardTitle className={marketingCardTitleClass}>Self-hosted</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              Install on your machine or run your own private server. Your workspace
              data stays with you. Open source on GitHub.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$0</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Free to run. Add a Seller seat below to earn on Community Marketplace.
            </p>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button render={<Link to={`${MARKETING_BASE}/downloads`} />}>
              Downloads
            </Button>
            <Button
              variant="outline"
              render={
                <a
                  href="https://github.com/ReBoticsAI/GodMode"
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              GitHub
            </Button>
          </CardFooter>
        </Card>

        <Card className={marketingCardClass}>
          <CardHeader>
            <CardTitle className={marketingCardTitleClass}>GodMode Seller</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              Earn on the Community Marketplace from Self-Hosted GodMode. Your builds and
              workspace data stay on your machine. Seller is commerce-only, not a full Cloud
              workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$4.99</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Per month. Sellers keep 90% on Community sales. Cancel from the billing portal.
            </p>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button render={<Link to={marketingSelfHostedSellUrl()} />}>
              Sell from Self-Hosted
            </Button>
            <Button variant="outline" render={<a href={CLOUD_APP_HOME} />}>
              Already on Cloud
            </Button>
          </CardFooter>
        </Card>

        <Card className={marketingCardClass}>
          <CardHeader>
            <CardTitle className={marketingCardTitleClass}>Cloud Monthly</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              We host GodMode for you. Choose a plan, pay with Stripe, then create your
              account and verify email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$9.99</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Per month. Cancel anytime from the billing portal.
            </p>
          </CardContent>
          <CardFooter>
            <Button render={<a href={CLOUD_APP_HOME} />}>Start Cloud signup</Button>
          </CardFooter>
        </Card>

        <Card className={marketingCardClass}>
          <CardHeader>
            <CardTitle className={marketingCardTitleClass}>Cloud Yearly</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              Same Cloud experience, billed once a year at a lower total cost.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$74.99</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Lower yearly total than twelve monthly payments (about 4.5 months of savings).
            </p>
          </CardContent>
          <CardFooter>
            <Button render={<a href={CLOUD_APP_HOME} />}>Start Cloud signup</Button>
          </CardFooter>
        </Card>
      </div>

      <p className="max-w-5xl text-base leading-relaxed text-muted-foreground">
        Before you pay, you must acknowledge that Cloud and Seller subscriptions are
        non-refundable (no refunds, no liability). Official Marketplace sales are likewise
        final. Community Marketplace purchases settle through the payment processor; disputes
        are between buyer and seller, except we look into failed access provisioning via
        support. Buying in the Marketplace is separate from your Cloud or Seller
        subscription. Details:{" "}
        <Link
          to={`${MARKETING_BASE}/terms`}
          className="text-foreground underline underline-offset-4"
        >
          Terms
        </Link>{" "}
        and{" "}
        <Link
          to={`${MARKETING_BASE}/refund`}
          className="text-foreground underline underline-offset-4"
        >
          Refund policy
        </Link>
        .
      </p>
    </Page>
  );
}
