import { useEffect, useState } from "react";
import { CloudIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FloatingWindow } from "@/components/floating/FloatingWindow";
import { cn } from "@/lib/utils";
import {
  CLOUD_GUIDE_OPEN_EVENT,
  CLOUD_GUIDE_SECTION_EVENT,
  CLOUD_GUIDE_STOPS,
  CLOUD_MONTHLY_PRICE,
  CLOUD_SIGNUP_URL,
  CLOUD_YEARLY_PRICE,
} from "@/lib/cloud-guide";
import { GRAPH_TOUR_RESET_EVENT } from "@/lib/guide-ui-action";

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
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(CLOUD_GUIDE_STOPS[0]?.id ?? "workspace");

  useEffect(() => {
    if (!open) return;
    document.getElementById(`cloud-guide-${activeId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [open, activeId]);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setActiveId(CLOUD_GUIDE_STOPS[0]?.id ?? "workspace");
    };
    const onSection = (ev: Event) => {
      const id = (ev as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setOpen(true);
      setActiveId(id);
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

  return (
    <FloatingWindow
      open={open}
      title="GodMode Cloud"
      icon={<CloudIcon className="size-4" />}
      windowId="cloud-guide"
      role="information"
      pairGroup="focus-pair"
      placement="focus-right"
      forceFocusTile
      defaultWidth={420}
      defaultHeight={640}
      onClose={() => setOpen(false)}
    >
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
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
              {stop.id === "signup" ? (
                <CardFooter>
                  <Button
                    render={
                      <a href={CLOUD_SIGNUP_URL} target="_blank" rel="noreferrer" />
                    }
                  >
                    Continue to Cloud signup
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          );
        })}
        <Separator />
        <p className="text-xs text-muted-foreground">
          Prices match the public pricing page. Purchases are non-refundable.
        </p>
      </div>
    </FloatingWindow>
  );
}
