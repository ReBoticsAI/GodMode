import { ProjectsBoard } from "@/components/intelligence/projects/ProjectsBoard";
import { Page, PageHeader } from "@/components/PageHeader";
import { ShareDialog } from "@/components/ShareDialog";
import { useTenant } from "@/lib/tenant-context";

export default function UserTasksPage() {
  const { user } = useTenant();
  const userId = user?.id ?? "";

  return (
    <Page>
      <PageHeader
        title="Tasks"
        description="Your personal task board — organize work across backlog, in progress, review, and done."
        actions={
          userId ? (
            <ShareDialog
              resourceKind="user_tasks"
              resourceId={userId}
              resourceLabel="My Tasks"
            />
          ) : null
        }
      />
      <div className="flex min-h-[560px] flex-1 flex-col rounded-lg border bg-card/30 p-3">
        <ProjectsBoard scope={{ kind: "user" }} />
      </div>
    </Page>
  );
}
