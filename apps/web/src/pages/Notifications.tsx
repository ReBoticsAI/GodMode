import { Page, PageHeader } from "@/components/PageHeader";
import { NotificationsList } from "@/components/NotificationsList";

export default function Notifications() {
  return (
    <Page>
      <PageHeader
        title="Notifications"
        description="Activity from messages, automations, support, shares, and platform releases."
      />
      <div className="mx-auto h-[calc(100vh-12rem)] w-full max-w-2xl">
        <NotificationsList />
      </div>
    </Page>
  );
}
