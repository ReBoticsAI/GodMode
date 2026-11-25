import { useEffect } from "react";
import { MessageCircleIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { IntelligencePanel } from "@/components/intelligence/IntelligencePanel";
import { useIntelligence } from "@/lib/intelligence-context";
import { useTenant } from "@/lib/tenant-context";
import { useIsPhone } from "@/hooks/use-mobile";
import { ChatAppsMenu } from "./ChatAppsMenu";
import { ChatContextRail } from "./ChatContextRail";

/**
 * Chat-first signed-in home: directory + conversation (Intelligence shell) +
 * context rail. Graph and floating windows are not part of this shell.
 */
export function ChatAppShell() {
  const { setPanelOpen, setPanelMinimized, setPanelMaximized } =
    useIntelligence();
  const { user } = useTenant();
  const isPhone = useIsPhone();
  const initials =
    (user?.displayName || user?.email || "U")
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U";

  useEffect(() => {
    setPanelOpen(true);
    setPanelMinimized(false);
    setPanelMaximized(false);
  }, [setPanelOpen, setPanelMinimized, setPanelMaximized]);

  return (
    <SidebarProvider className="h-dvh min-h-0">
      <div className="flex h-dvh w-full min-w-0 flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="md:hidden" />
          <div className="flex items-center gap-2">
            <MessageCircleIcon className="size-4 text-muted-foreground" />
            <span className="font-heading text-sm tracking-tight">GodMode</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ChatAppsMenu />
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <Separator />
        <div className="flex min-h-0 flex-1">
          <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
            <IntelligencePanel layout="shell" />
          </SidebarInset>
          {!isPhone ? <ChatContextRail /> : null}
        </div>
        {isPhone ? <ChatContextRail /> : null}
      </div>
    </SidebarProvider>
  );
}
