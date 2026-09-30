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
import { InferenceOfferBilling } from "@/components/graph/InferenceOfferBilling";
import { cn } from "@/lib/utils";
import { GRAPH_TOUR_RESET_EVENT } from "@/lib/guide-ui-action";
import {
  INFERENCE_OFFER_OPEN_EVENT,
  INFERENCE_OFFER_SECTION_EVENT,
  inferenceOfferStops,
  inferenceOfferTitle,
  type InferenceOfferKind,
} from "@/lib/inference-offer";

export function InferenceOfferWindow() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<InferenceOfferKind>("inference");
  const [activeId, setActiveId] = useState("supply");

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const next = (ev as CustomEvent<{ kind?: InferenceOfferKind }>).detail?.kind;
      const resolved = next === "cloud_inference" ? "cloud_inference" : "inference";
      setKind(resolved);
      setActiveId(inferenceOfferStops(resolved)[0]?.id ?? "supply");
      setOpen(true);
    };
    const onSection = (ev: Event) => {
      const id = (ev as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setActiveId(id);
      setOpen(true);
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

  const stops = inferenceOfferStops(kind);
  const title = inferenceOfferTitle(kind);

  return (
    <FloatingWindow
      open={open}
      title={title}
      icon={
        kind === "cloud_inference" ? (
          <CloudIcon className="size-4" />
        ) : (
          <SparklesIcon className="size-4" />
        )
      }
      windowId="inference-offer"
      role="information"
      pairGroup="focus-pair"
      placement="focus-right"
      forceFocusTile
      defaultWidth={420}
      defaultHeight={720}
      onClose={() => setOpen(false)}
    >
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
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
          Prices match the packs published in GodMode. Stripe Checkout is the payment step, then you return here.
        </p>
      </div>
    </FloatingWindow>
  );
}
