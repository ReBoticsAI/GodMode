import { useEffect, useState } from "react";
import { CloudIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { FloatingWindow } from "@/components/floating/FloatingWindow";
import { GraphPhoneSheet } from "@/components/graph/GraphPhoneSheet";
import { useIsPhone } from "@/hooks/use-mobile";
import { useIntelligence } from "@/lib/intelligence-context";
import { cn } from "@/lib/utils";
import {
  CLOUD_GUIDE_OPEN_EVENT,
  CLOUD_GUIDE_SECTION_EVENT,
  CLOUD_GUIDE_STOPS,
  CLOUD_MONTHLY_PRICE,
  CLOUD_SIGNUP_URL,
  CLOUD_YEARLY_PRICE,
  openCloudSignupFallback,
} from "@/lib/cloud-guide";
import { canBillEmail, startCloudSeatCheckout } from "@/lib/inference-checkout";
import { GRAPH_TOUR_RESET_EVENT } from "@/lib/guide-ui-action";
import { dismissPhoneSurface } from "@/lib/phone-surface-stack";
import { isPhoneViewport } from "@/lib/graph-phone-shell";

const SECTION_COPY: Record<
  string,
  { title: string; body: string; price?: string; detail?: string }
> = {
  workspace: {
    title: "GodMode Cloud",
    body: "We host the workspace. Sign in from any device. Nothing stays running on this computer. The open-source install on your machine is the local path.",
  },
  monthly: {
    title: "Cloud Monthly",
    price: CLOUD_MONTHLY_PRICE,
    body: "Per month. Choose the plan, pay with Stripe, then create your account and verify email.",
    detail: "Cancel anytime from the billing portal.",
  },
  yearly: {
    title: "Cloud Yearly",
    price: CLOUD_YEARLY_PRICE,
    body: "Same hosted workspace, billed once a year.",
    detail: "Lower yearly total than twelve monthly payments (about 4.5 months of savings).",
  },
  keys: {
    title: "Your model keys",
    body: "Cloud is the hosted workspace. Bring your own keys for DeepSeek, Z.AI, or Qwen and pay those providers directly.",
    detail: "Cloud with Inference is the other choice: GodMode supplies the models as well.",
  },
  signup: {
    title: "Create the account",
    body: "Pick Monthly or Yearly, acknowledge that Cloud purchases are non-refundable, then continue to payment. The account is created after payment.",
  },
};

export function CloudGuideWindow() {
  const isPhone = useIsPhone();
  const { phoneCanGoBack, phoneGoBack } = useIntelligence();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(CLOUD_GUIDE_STOPS[0]?.id ?? "workspace");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`cloud-guide-${activeId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [open, activeId]);

  useEffect(() => {
    const present = () => {
      setOpen(true);
      setActiveId(CLOUD_GUIDE_STOPS[0]?.id ?? "workspace");
      // Phone: Social is z above FloatingWindow; dismiss so this sheet is primary.
      if (isPhoneViewport()) dismissPhoneSurface();
    };
    const onOpen = () => present();
    const onSection = (ev: Event) => {
      const id = (ev as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setOpen(true);
      setActiveId(id);
      if (isPhoneViewport()) dismissPhoneSurface();
    };
    const onReset = () => setOpen(false);
    window.addEventListener(CLOUD_GUIDE_OPEN_EVENT, onOpen);
    window.addEventListener(CLOUD_GUIDE_SECTION_EVENT, onSection);
    window.addEventListener(GRAPH_TOUR_RESET_EVENT, onReset);
    return () => {
      window.removeEventListener(CLOUD_GUIDE_OPEN_EVENT, onOpen);
      window.removeEventListener(CLOUD_GUIDE_SECTION_EVENT, onSection);
      window.removeEventListener(GRAPH_TOUR_RESET_EVENT, onReset);
    };
  }, []);

  const close = () => {
    setOpen(false);
    if (isPhoneViewport() && phoneCanGoBack) phoneGoBack();
  };

  const buyPlan = async (planId: string) => {
    if (!canBillEmail(email, false)) {
      toast.error("Enter the email for the Cloud account");
      return;
    }
    setBusy(planId);
    try {
      await startCloudSeatCheckout(email, planId);
    } catch (err) {
      // Local installs often lack SaaS Stripe. Fall back to the public Cloud app.
      const msg = err instanceof Error ? err.message : "Checkout failed";
      toast.message(`${msg}. Opening Cloud signup…`);
      openCloudSignupFallback(planId, email);
      setBusy(null);
    }
  };

  // Natural-height column: phone Sheet / FloatingWindow own scrolling.
  const body = (
    <div className="flex flex-col gap-3 p-3">
      {CLOUD_GUIDE_STOPS.map((stop) => {
        const copy = SECTION_COPY[stop.id];
        if (!copy) return null;
        const active = stop.id === activeId;
        return (
          <Card
            key={stop.id}
            id={`cloud-guide-${stop.id}`}
            className={cn(active && "ring-2 ring-ring")}
          >
            <CardHeader>
              <CardTitle>{copy.title}</CardTitle>
              <CardDescription>{copy.body}</CardDescription>
            </CardHeader>
            {(copy.price || copy.detail) && (
              <CardContent className="flex flex-col gap-1">
                {copy.price ? (
                  <p className="text-3xl font-bold">{copy.price}</p>
                ) : null}
                {copy.detail ? (
                  <p className="text-sm text-muted-foreground">{copy.detail}</p>
                ) : null}
              </CardContent>
            )}
          </Card>
        );
      })}
      <Card>
        <CardHeader>
          <CardTitle>Pay and create account</CardTitle>
          <CardDescription>
            Stripe Checkout opens next. After payment you create the account and verify email.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="cloud-guide-email">Email for Cloud</FieldLabel>
            <Input
              id="cloud-guide-email"
              type="email"
              autoComplete="email"
              value={email}
              placeholder="you@example.com"
              onChange={(ev) => setEmail(ev.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void buyPlan("monthly")}
            >
              {busy === "monthly"
                ? "Opening Stripe…"
                : `Cloud Monthly ${CLOUD_MONTHLY_PRICE}`}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => void buyPlan("yearly")}
            >
              {busy === "yearly"
                ? "Opening Stripe…"
                : `Cloud Yearly ${CLOUD_YEARLY_PRICE}`}
            </Button>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            variant="ghost"
            size="sm"
            render={
              <a href={CLOUD_SIGNUP_URL} target="_blank" rel="noreferrer" />
            }
          >
            Open Cloud signup page
          </Button>
        </CardFooter>
      </Card>
      <Separator />
      <p className="text-xs text-muted-foreground">
        Prices match the public pricing page. Purchases are non-refundable.
      </p>
    </div>
  );

  if (isPhone) {
    return (
      <GraphPhoneSheet
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title="GodMode Cloud"
        icon={<CloudIcon className="size-4" />}
        windowId="cloud-guide"
        showBack={phoneCanGoBack}
        onBack={close}
      >
        {body}
      </GraphPhoneSheet>
    );
  }

  return (
    <FloatingWindow
      open={open}
      title="GodMode Cloud"
      icon={<CloudIcon className="size-4" />}
      windowId="cloud-guide"
      role="generic"
      // Independent float: generic role stays out of Social focus-tiling.
      placement="right"
      defaultWidth={420}
      defaultHeight={640}
      onClose={() => setOpen(false)}
    >
      {body}
    </FloatingWindow>
  );
}
