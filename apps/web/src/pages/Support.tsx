import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { LifeBuoyIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * Support intake is Agent-first: Chat Intelligence with the Support skill.
 * Legacy ticket inbox is retired; report_* tools + GitHub / Admin notify replace it.
 */
export default function Support() {
  return (
    <Page>
      <PageHeader title="Support" description="Report problems through Intelligence." />
      <SupportContent />
    </Page>
  );
}

/** Support body for the full route or an embedded Graph floating window. */
export function SupportContent({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const navigate = useNavigate();

  const openChat = () => {
    if (!embedded) {
      navigate("/");
    }
    window.dispatchEvent(new CustomEvent("godmode:open-intelligence-chat"));
  };

  return (
    <Empty className="min-h-[16rem] border-0 px-4 py-8">
      <EmptyHeader className="max-w-lg">
        <EmptyMedia variant="icon">
          <LifeBuoyIcon />
        </EmptyMedia>
        <EmptyTitle>Report via Intelligence</EmptyTitle>
        <EmptyDescription>
          Agents use the Support skill to file OSS bugs on GitHub (with dedupe),
          private Admin ops reports, or shared-resource owner notifications. Ask
          Intelligence to report the problem; do not use the old ticket inbox.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={openChat}>
          Open chat with Intelligence
        </Button>
      </EmptyContent>
    </Empty>
  );
}
