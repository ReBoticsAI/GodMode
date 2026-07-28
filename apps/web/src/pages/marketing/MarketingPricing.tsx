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
        description="Self-host for free (desktop, clone, or private hub). GodMode Cloud is hosted multi-tenant SaaS: choose a plan, pay with Stripe, then create your account. Marketplace purchases are separate from the Cloud subscription."
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
            <CardDescription>
              Hosted SaaS seat. Flow: plan → Stripe Checkout → create account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$9.99</p>
            <p className="mt-1 text-base text-muted-foreground">
              Cancel anytime in the Customer Portal. Email verification required after signup
              (platform admins may be exempt for bootstrap).
            </p>
          </CardContent>
          <CardFooter>
            <Button render={<Link to="/" />}>Start Cloud signup</Button>
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
            <Button render={<Link to="/" />}>Start Cloud signup</Button>
          </CardFooter>
        </Card>
      </div>

      <p className="max-w-5xl text-base leading-relaxed text-muted-foreground">
        Before Checkout you must acknowledge the non-refund policy. Marketplace purchases are
        separate from the Cloud subscription. See{" "}
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
