import { Page, PageHeader } from "@/components/PageHeader";
import { UserProfilePanel } from "@/components/UserProfilePanel";

export default function Users() {
  return (
    <Page>
      <PageHeader
        title="Profile"
        description="Your profile, account security, and projects."
      />
      <UsersContent />
    </Page>
  );
}

/** Profile body for the full route or an embedded Graph floating window. */
export function UsersContent() {
  return <UserProfilePanel />;
}
