import { NavLink } from "react-router-dom";
import { LogOutIcon, SettingsIcon, ShieldIcon } from "lucide-react";
import { SidebarNav } from "@/components/SidebarNav";
import { ADMIN_PATH, APP_NAME, HOME_PATH, SETTINGS_PATH } from "@/lib/navigation";
import { logoutAuth } from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { cn } from "@/lib/utils";

const footerLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-muted-foreground"
  );

export function SidebarShellContent({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const { user, refresh } = useTenant();
  const isAdmin = Boolean(user?.isAdmin);

  const signOut = async () => {
    try {
      await logoutAuth();
    } catch {
      /* ignore */
    }
    await refresh();
  };

  return (
    <>
      <div className="flex w-full justify-center px-2 py-1.5">
        <NavLink
          to={HOME_PATH}
          onClick={onNavigate}
          className="font-heading truncate text-4xl font-extrabold leading-none tracking-tight transition-opacity hover:opacity-80"
          aria-label="Go to home"
        >
          {APP_NAME}
        </NavLink>
      </div>

      <SidebarNav onNavigate={onNavigate} />

      <div className="mt-auto flex flex-col gap-1 pt-2">
        {isAdmin && (
          <NavLink to={ADMIN_PATH} onClick={onNavigate} className={footerLinkClass}>
            <ShieldIcon className="size-4 shrink-0" />
            Admin
          </NavLink>
        )}
        <NavLink to={SETTINGS_PATH} onClick={onNavigate} className={footerLinkClass}>
          <SettingsIcon className="size-4 shrink-0" />
          Settings
        </NavLink>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            void signOut();
          }}
          className={cn(
            footerLinkClass({ isActive: false }),
            "w-full text-left"
          )}
        >
          <LogOutIcon className="size-4 shrink-0" />
          Sign out
        </button>
      </div>
    </>
  );
}
