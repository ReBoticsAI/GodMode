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
        description="Self-host for free. GodMode Cloud is the hosted multi-tenant SaaS with Marketplace commerce authority."
        descriptionClassName="max-w-5xl text-base leading-relaxed"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Self-hosted</CardTitle>
            <CardDescription>Run locally or on your own private hub.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$0</p>
            <p className="mt-1 text-base text-muted-foreground">Your data, your machine.</p>
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
            <CardDescription>Hosted SaaS seat with Stripe Checkout.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$9.99</p>
            <p className="mt-1 text-base text-muted-foreground">
              Cancel anytime in the Customer Portal.
            </p>
          </CardContent>
          <CardFooter>
            <Button render={<Link to="/" />}>Subscribe</Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cloud Yearly</CardTitle>
            <CardDescription>Same Cloud product, billed annually.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$74.99</p>
            <p className="mt-1 text-base text-muted-foreground">
              Exact Stripe Price IDs are configured per environment.
            </p>
          </CardContent>
          <CardFooter>
            <Button render={<Link to="/" />}>Subscribe</Button>
          </CardFooter>
        </Card>
      </div>

      <p className="max-w-5xl text-base leading-relaxed text-muted-foreground">
        Marketplace purchases are separate from the Cloud subscription. See{" "}
        <Link
          to={`${MARKETING_BASE}/terms`}
          className="text-foreground underline underline-offset-4"
        >
          Terms
        </Link>{" "}
        and the{" "}
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
