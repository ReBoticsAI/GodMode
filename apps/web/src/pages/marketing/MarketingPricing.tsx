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
import { cn } from "@/lib/utils";
import {
  MARKETING_BASE,
  marketingCardClass,
  marketingCardDescriptionClass,
  marketingCardTitleClass,
  marketingPageDescriptionClass,
} from "./MarketingLayout";
import { CLOUD_APP_HOME } from "./cloudAppUrl";
import {
  CLOUD_INFERENCE_PLUS_PRICE,
  CLOUD_INFERENCE_PLUS_YEARLY,
  CLOUD_INFERENCE_PRO_PRICE,
  CLOUD_INFERENCE_PRO_YEARLY,
  CLOUD_INFERENCE_STARTER_PRICE,
  CLOUD_INFERENCE_STARTER_YEARLY,
  CLOUD_MONTHLY_PRICE,
  CLOUD_YEARLY_PRICE,
} from "@/lib/cloud-guide";
import {
  INFERENCE_PACK_PRICE,
  INFERENCE_PACK_PRICES,
  playInferenceOffer,
} from "@/lib/inference-offer";

const pricingCardClass = cn(marketingCardClass, "h-full");
const pricingHeaderClass = "flex-1";
const pricingContentClass = "mt-auto";
const pricingFooterClass = "flex flex-wrap gap-2";

export default function MarketingPricing() {
  return (
    <Page>
      <PageHeader
        title="Pricing"
        description="Open-source GodMode on your machine or hosted in Cloud. Self-Hosted is free. GodMode Inference supplies the models. Cloud with Inference hosts the workspace and the models. Add a Seller seat to earn on the Community Marketplace while your data stays local."
        descriptionClassName={marketingPageDescriptionClass}
      />

      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className={pricingCardClass}>
          <CardHeader className={pricingHeaderClass}>
            <CardTitle className={marketingCardTitleClass}>Self-hosted</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              Install on your machine or run your own private server. Your workspace
              data stays with you. Open source on GitHub.
            </CardDescription>
          </CardHeader>
          <CardContent className={pricingContentClass}>
            <p className="text-3xl font-bold">$0</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Free to run. Add a Seller seat to earn on Community Marketplace.
            </p>
          </CardContent>
          <CardFooter className={pricingFooterClass}>
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

        <Card className={pricingCardClass}>
          <CardHeader className={pricingHeaderClass}>
            <CardTitle className={marketingCardTitleClass}>GodMode Inference</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              The model supply for a local install or for GodMode Cloud. GodMode runs the
              model. You do not bring a key on this path.
            </CardDescription>
          </CardHeader>
          <CardContent className={pricingContentClass}>
            <p className="text-3xl font-bold">From {INFERENCE_PACK_PRICE}</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Prepaid packs: {INFERENCE_PACK_PRICES.join(", ")}. Tops up the managed
              balance at face value. The model is GLM 5.3 Flash.
            </p>
          </CardContent>
          <CardFooter className={pricingFooterClass}>
            <Button type="button" onClick={() => playInferenceOffer("inference")}>
              See Inference
            </Button>
          </CardFooter>
        </Card>

        <Card className={pricingCardClass}>
          <CardHeader className={pricingHeaderClass}>
            <CardTitle className={marketingCardTitleClass}>GodMode Seller</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              Earn on the Community Marketplace from Self-Hosted GodMode. Your builds and
              workspace data stay on your machine. Seller is commerce-only, not a full Cloud
              workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className={pricingContentClass}>
            <p className="text-3xl font-bold">$4.99</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Per month. Sellers keep 90% on Community sales. Cancel from the billing portal.
            </p>
          </CardContent>
          <CardFooter className={pricingFooterClass}>
            <Button render={<a href={CLOUD_APP_HOME} />}>Start Seller Signup</Button>
          </CardFooter>
        </Card>

        <Card className={pricingCardClass}>
          <CardHeader className={pricingHeaderClass}>
            <CardTitle className={marketingCardTitleClass}>Cloud Monthly</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              We host GodMode for you. Bring your own model keys. Choose a plan, pay with
              Stripe, then create your account and verify email.
            </CardDescription>
          </CardHeader>
          <CardContent className={pricingContentClass}>
            <p className="text-3xl font-bold">{CLOUD_MONTHLY_PRICE}</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Per month. Cancel anytime from the billing portal.
            </p>
          </CardContent>
          <CardFooter className={pricingFooterClass}>
            <Button render={<a href={CLOUD_APP_HOME} />}>Start Cloud signup</Button>
          </CardFooter>
        </Card>

        <Card className={pricingCardClass}>
          <CardHeader className={pricingHeaderClass}>
            <CardTitle className={marketingCardTitleClass}>Cloud Yearly</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              Same Cloud experience, billed once a year at a lower total cost.
            </CardDescription>
          </CardHeader>
          <CardContent className={pricingContentClass}>
            <p className="text-3xl font-bold">{CLOUD_YEARLY_PRICE}</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Lower yearly total than twelve monthly payments (about 4.5 months of savings).
            </p>
          </CardContent>
          <CardFooter className={pricingFooterClass}>
            <Button render={<a href={CLOUD_APP_HOME} />}>Start Cloud signup</Button>
          </CardFooter>
        </Card>

        <Card className={pricingCardClass}>
          <CardHeader className={pricingHeaderClass}>
            <CardTitle className={marketingCardTitleClass}>Cloud with Inference</CardTitle>
            <CardDescription className={marketingCardDescriptionClass}>
              GodMode hosts the workspace and supplies the models. One Subscribe includes
              Cloud and monthly Inference credit. You do not bring your own key.
            </CardDescription>
          </CardHeader>
          <CardContent className={pricingContentClass}>
            <p className="text-3xl font-bold">From {CLOUD_INFERENCE_STARTER_PRICE}</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              Starter {CLOUD_INFERENCE_STARTER_PRICE}/mo ($5 credit), Plus{" "}
              {CLOUD_INFERENCE_PLUS_PRICE}/mo ($10), Pro {CLOUD_INFERENCE_PRO_PRICE}/mo ($25).
              Yearly {CLOUD_INFERENCE_STARTER_YEARLY} / {CLOUD_INFERENCE_PLUS_YEARLY} /{" "}
              {CLOUD_INFERENCE_PRO_YEARLY}. Save vs buying Cloud and packs separately. GLM
              5.3 Flash.
            </p>
          </CardContent>
          <CardFooter className={pricingFooterClass}>
            <Button type="button" onClick={() => playInferenceOffer("cloud_inference")}>
              See Cloud with Inference
            </Button>
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
