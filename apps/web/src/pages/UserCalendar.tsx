import { CalendarBoard } from "@/components/intelligence/calendar/CalendarBoard";
import { Page, PageHeader } from "@/components/PageHeader";
import { ShareDialog } from "@/components/ShareDialog";
import { useTenant } from "@/lib/tenant-context";

export default function UserCalendarPage() {
  const { user } = useTenant();
  const userId = user?.id ?? "";

  return (
    <Page>
      <PageHeader
        title="Calendar"
        description="Your personal calendar — private by default. Share it with teammates or agents when you need to collaborate."
        actions={
          userId ? (
            <ShareDialog
              resourceKind="user_calendar"
              resourceId={userId}
              resourceLabel="My Calendar"
            />
          ) : null
        }
      />
      <div className="flex min-h-[560px] flex-1 flex-col rounded-lg border bg-card/30 p-3">
        <CalendarBoard scope={{ kind: "user" }} />
      </div>
    </Page>
  );
}
