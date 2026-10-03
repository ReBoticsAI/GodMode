import { useEffect, useState } from "react";
import { CloudIcon, SparklesIcon } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FloatingWindow } from "@/components/floating/FloatingWindow";
import { GraphPhoneSheet } from "@/components/graph/GraphPhoneSheet";
import { InferenceOfferBilling } from "@/components/graph/InferenceOfferBilling";
import { useIsPhone } from "@/hooks/use-mobile";
import { useIntelligence } from "@/lib/intelligence-context";
import { cn } from "@/lib/utils";
import { GRAPH_TOUR_RESET_EVENT } from "@/lib/guide-ui-action";
import { isPhoneViewport } from "@/lib/graph-phone-shell";
import { dismissPhoneSurface } from "@/lib/phone-surface-stack";
import {
  INFERENCE_OFFER_OPEN_EVENT,
  INFERENCE_OFFER_SECTION_EVENT,
  inferenceOfferStops,
  inferenceOfferTitle,
  type InferenceOfferKind,
} from "@/lib/inference-offer";

export function InferenceOfferWindow() {
  const isPhone = useIsPhone();
  const { phoneCanGoBack, phoneGoBack } = useIntelligence();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<InferenceOfferKind>("inference");
  const [activeId, setActiveId] = useState("supply");

  useEffect(() => {
    const present = (resolved: InferenceOfferKind) => {
      setKind(resolved);
      setActiveId(inferenceOfferStops(resolved)[0]?.id ?? "supply");
      setOpen(true);
      if (isPhoneViewport()) dismissPhoneSurface();
    };
    const onOpen = (ev: Event) => {
      const next = (ev as CustomEvent<{ kind?: InferenceOfferKind }>).detail?.kind;
      present(next === "cloud_inference" ? "cloud_inference" : "inference");
    };
    const onSection = (ev: Event) => {
      const id = (ev as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setActiveId(id);
      setOpen(true);
      if (isPhoneViewport()) dismissPhoneSurface();
    };
    const onReset = () => setOpen(false);
    window.addEventListener(INFERENCE_OFFER_OPEN_EVENT, onOpen);
    window.addEventListener(INFERENCE_OFFER_SECTION_EVENT, onSection);
    window.addEventListener(GRAPH_TOUR_RESET_EVENT, onReset);
    return () => {
      window.removeEventListener(INFERENCE_OFFER_OPEN_EVENT, onOpen);
      window.removeEventListener(INFERENCE_OFFER_SECTION_EVENT, onSection);
      window.removeEventListener(GRAPH_TOUR_RESET_EVENT, onReset);
    };
  }, []);

  const close = () => {
    setOpen(false);
    if (isPhoneViewport() && phoneCanGoBack) phoneGoBack();
  };

  const stops = inferenceOfferStops(kind);
  const title = inferenceOfferTitle(kind);
  const icon =
    kind === "cloud_inference" ? (
      <CloudIcon className="size-4" />
    ) : (
      <SparklesIcon className="size-4" />
    );

  // Natural-height column: phone Sheet / FloatingWindow own scrolling.
  // Avoid h-full + nested overflow-y-auto (clips under density zoom).
  const body = (
    <div className="flex flex-col gap-3 p-3">
      {stops.map((stop) => (
        <Card
          key={stop.id}
          id={`inference-offer-${stop.id}`}
          className={cn(stop.id === activeId && "ring-2 ring-ring")}
        >
          <CardHeader>
            <CardTitle>{stop.title}</CardTitle>
            <CardDescription>{stop.say}</CardDescription>
          </CardHeader>
        </Card>
      ))}
      <InferenceOfferBilling kind={kind} open={open} />
      <Separator />
      <p className="text-xs text-muted-foreground">
        Prices match the packs published in GodMode. Stripe Checkout is the payment
        step, then you return here.
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
        title={title}
        icon={icon}
        windowId="inference-offer"
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
      title={title}
      icon={icon}
      windowId="inference-offer"
      role="generic"
      // Independent float: generic role stays out of Social focus-tiling.
      placement="right"
      defaultWidth={420}
      defaultHeight={720}
      onClose={() => setOpen(false)}
    >
      {body}
    </FloatingWindow>
  );
}
