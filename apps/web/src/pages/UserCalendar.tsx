import { CalendarBoard } from "@/components/intelligence/calendar/CalendarBoard";
import { Page, PageHeader } from "@/components/PageHeader";
import { ShareDialog } from "@/components/ShareDialog";
import { useTenant } from "@/lib/tenant-context";

export default function UserCalendarPage() {
  const { user } = useTenant();
  const userId = user?.id ?? "";

  return (
    <Page className="flex h-[calc(100dvh-7rem)] max-w-none flex-col gap-4 overflow-hidden">
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card/30 p-3">
        <CalendarBoard scope={{ kind: "user" }} />
      </div>
    </Page>
  );
}
