import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpenIcon,
  CalendarIcon,
  LayoutGridIcon,
  ListTodoIcon,
  MessageCircleIcon,
  NetworkIcon,
  SettingsIcon,
  ShieldIcon,
  StoreIcon,
  VaultIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ADMIN_PATH,
  CALENDAR_PATH,
  HOME_PATH,
  MARKETPLACE_PATH,
  PLATFORM_VAULT_PATH,
  SETTINGS_PATH,
  STRUCTURE_PATH,
  TASKS_PATH,
  VAULT_PATH,
  WIKI_PATH,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

const APPS = [
  { label: "Chat", path: HOME_PATH, icon: MessageCircleIcon },
  { label: "Wiki", path: WIKI_PATH, icon: BookOpenIcon },
  { label: "Tasks", path: TASKS_PATH, icon: ListTodoIcon },
  { label: "Calendar", path: CALENDAR_PATH, icon: CalendarIcon },
  { label: "Vault", path: VAULT_PATH, icon: VaultIcon },
  { label: "Platform Vault", path: PLATFORM_VAULT_PATH, icon: VaultIcon },
  { label: "Settings", path: SETTINGS_PATH, icon: SettingsIcon },
  { label: "Structure", path: STRUCTURE_PATH, icon: NetworkIcon },
  { label: "Marketplace", path: MARKETPLACE_PATH, icon: StoreIcon },
  { label: "Admin", path: ADMIN_PATH, icon: ShieldIcon },
] as const;

export function ChatAppsMenu({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className={cn(className)} />
        }
      >
        <LayoutGridIcon data-icon="inline-start" />
        Apps
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apps</DialogTitle>
          <DialogDescription>
            Open a deep surface. Chat stays your home.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {APPS.map(({ label, path, icon: Icon }) => (
            <Button
              key={path}
              variant="outline"
              className="h-auto flex-col gap-2 py-4"
              onClick={() => {
                setOpen(false);
                navigate(path);
              }}
            >
              <Icon />
              <span>{label}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
