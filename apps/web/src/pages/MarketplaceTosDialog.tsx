import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MARKETING_BASE } from "@/pages/marketing/marketingBase";

export function MarketplaceTosBody({ version }: { version: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm text-muted-foreground">
      <p>
        These terms apply to buying and selling on the GodMode Marketplace (Official catalog and
        Community listings). GodMode Cloud subscription terms are separate. Operator: ReBotics AI.
        Version {version}.
      </p>
      <div>
        <p className="font-medium text-foreground">Official vs Community</p>
        <ul className="mt-1 list-disc pl-4">
          <li>
            Official ReBotics catalog items: merchant of record is ReBotics/GodMode. Revenue is 100%
            to the platform.
          </li>
          <li>
            Community listings: the sale is between buyer and seller through the payment processor.
            The platform takes 10%. The rest goes to the seller via their connected payout.
          </li>
        </ul>
      </div>
      <div>
        <p className="font-medium text-foreground">Stripe Connect</p>
        <p className="mt-1">
          On Community Stripe Connect checkout you are the merchant of record. GodMode takes 10%.
          You handle listing accuracy, delivery or live access, and buyer disputes on your sales.
          GodMode may delist or ban for ToS violations or prohibited content. Connect sellers must
          attest compliance before publishing or binding.
        </p>
      </div>
      <div>
        <p className="font-medium text-foreground">Prohibited and restricted</p>
        <p className="mt-1">
          No gambling, adult sexual content, weapons or illegal goods, malware, or other clearly
          illegal activity. Align with Stripe restricted-business rules where Connect applies.
        </p>
      </div>
      <div>
        <p className="font-medium text-foreground">Live Share pin</p>
        <p className="mt-1">
          Live Share requires a Community catalog pin and a bound resource whose export matches that
          pin. Drift or a pin bump demotes the listing until you re-bind. Free Shared sidebar stays
          outside Marketplace.
        </p>
      </div>
      <div>
        <p className="font-medium text-foreground">Digital goods are final</p>
        <p className="mt-1">
          Marketplace items are software. Once payment succeeds and the item is delivered or install
          entitlement is granted, there are no refunds for delivered Official goods. Delivered
          Community goods are not refundable by GodMode. Ordinary disputes are between buyer and
          seller (and the payment processor).
        </p>
      </div>
      <div>
        <p className="font-medium text-foreground">Failed provisioning</p>
        <p className="mt-1">
          If payment succeeded but GodMode did not grant access, email support@godmode.software.
          That path is for failed access only. It is not a general refund right.
        </p>
      </div>
      <div>
        <p className="font-medium text-foreground">Chargebacks</p>
        <p className="mt-1">
          A chargeback or payment dispute after delivery permanently bans Marketplace access (no
          buying or earning). A Cloud seat may continue if the subscription is otherwise valid.
        </p>
      </div>
      <p>
        Full legal text:{" "}
        <Link className="text-foreground underline underline-offset-4" to={`${MARKETING_BASE}/terms`}>
          Terms of Service (Marketplace section)
        </Link>
        .
      </p>
    </div>
  );
}

export function MarketplaceTosDialog({
  open,
  onOpenChange,
  version,
  accepted,
  accepting,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: string;
  accepted: boolean;
  accepting?: boolean;
  onAccept: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>Marketplace Terms of Service</DialogTitle>
          <DialogDescription>
            Read these terms before accepting. Current version: {version}.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[min(24rem,50vh)] pr-3">
          <MarketplaceTosBody version={version} />
        </ScrollArea>
        <DialogFooter>
          {accepted ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <Button type="button" disabled={accepting} onClick={onAccept}>
              {accepting ? "Accepting…" : "Accept Marketplace ToS"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
