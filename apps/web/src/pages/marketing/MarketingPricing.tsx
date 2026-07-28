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
import { MARKETING_BASE } from "./MarketingLayout";

export default function MarketingPricing() {
  return (
    <Page>
      <PageHeader
        title="Pricing"
        description="Use GodMode for free on your own computer, or subscribe to GodMode Cloud so you can open it in a browser from any device. Marketplace add-ons are priced separately from your Cloud plan."
        descriptionClassName="max-w-5xl text-base leading-relaxed"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Self-hosted</CardTitle>
            <CardDescription>
              Install on your machine or run your own private server. Best if you want full
              control and do not mind setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$0</p>
            <p className="mt-1 text-base text-muted-foreground">
              Your data stays with you. Open source on GitHub.
            </p>
          </CardContent>
          <CardFooter>
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
              Get the source
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cloud Monthly</CardTitle>
            <CardDescription>
              We host GodMode for you. Pick a plan, pay securely, then create your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$9.99</p>
            <p className="mt-1 text-base text-muted-foreground">
              Cancel anytime from the billing portal. After signup we ask you to verify your
              email.
            </p>
          </CardContent>
          <CardFooter>
            <Button render={<Link to="/" />}>Start Cloud signup</Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cloud Yearly</CardTitle>
            <CardDescription>
              Same Cloud experience, billed once a year at a lower total cost.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$74.99</p>
            <p className="mt-1 text-base text-muted-foreground">
              About two months free versus paying month to month.
            </p>
          </CardContent>
          <CardFooter>
            <Button render={<Link to="/" />}>Start Cloud signup</Button>
          </CardFooter>
        </Card>
      </div>

      <p className="max-w-5xl text-base leading-relaxed text-muted-foreground">
        Before you pay, you must acknowledge that Cloud subscriptions are generally
        non-refundable (see the refund policy for the narrow exceptions). Buying something in
        the Marketplace is separate from your Cloud subscription. Details:{" "}
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
