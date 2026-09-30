import {
  BellIcon,
  BookOpenIcon,
  BotIcon,
  CalendarIcon,
  CodeIcon,
  HashIcon,
  InfoIcon,
  KeyRoundIcon,
  LandmarkIcon,
  LayersIcon,
  LifeBuoyIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIntelligence } from "@/lib/intelligence-context";
import { setActiveFloatingWindow } from "@/lib/floating-window-registry";
import { graphNodeColor } from "@/lib/graph-node-style";
import { useTheme } from "next-themes";

export function MinimizedWindowsDock() {
  const {
    panelOpen,
    panelMinimized,
    setPanelMinimized,
    chatTarget,
    activeAgentId,
    informationPanelOpen,
    informationPanelMinimized,
    setInformationPanelMinimized,
    informationNode,
    activeLeftTab,
    openChatWindows,
    setChatWindowMinimized,
    focusChatWindow,
    chatInboxOpen,
    chatInboxMinimized,
    setChatInboxMinimized,
    setChatInboxOpen,
  } = useIntelligence();
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";

  const showChat = panelOpen && panelMinimized;
  const showInfo = informationPanelOpen && informationPanelMinimized;
  const showInbox = chatInboxOpen && chatInboxMinimized;
  const minimizedThreads = openChatWindows.filter((w) => w.minimized);

  if (!showChat && !showInfo && !showInbox && minimizedThreads.length === 0)
    return null;

  const isDm = chatTarget.kind === "conversation";
  const chatTitle = isDm
    ? "Conversation"
    : activeAgentId
      ? activeAgentId.charAt(0).toUpperCase() + activeAgentId.slice(1)
      : "Chat";

  let infoTitle = informationNode
    ? `Information: ${informationNode.label}`
    : "Information";
  let infoAccent = informationNode
    ? graphNodeColor(
        informationNode.kind,
        informationNode.id,
        null,
        informationNode.objectType,
        informationNode.label,
        { isLight }
      )
    : "#a78bfa";

  if (activeLeftTab === "calendar") {
    infoTitle = "Calendar";
    infoAccent = "#38bdf8";
  } else if (activeLeftTab === "projects") {
    infoTitle = "Automations";
    infoAccent = "#a78bfa";
  } else if (activeLeftTab === "knowledge") {
    infoTitle = "Knowledge";
    infoAccent = "#34d399";
  } else if (activeLeftTab === "bank") {
    infoTitle = "Bank";
    infoAccent = "#fbbf24";
  } else if (activeLeftTab === "vault") {
    infoTitle = "Agent Vault";
    infoAccent = "#f87171";
  } else if (activeLeftTab === "platform-vault") {
    infoTitle = "Platform Vault";
    infoAccent = "#fbbf24";
  } else if (activeLeftTab === "admin") {
    infoTitle = "Admin";
    infoAccent = "#a78bfa";
  } else if (activeLeftTab === "wiki") {
    infoTitle = "Wiki";
    infoAccent = "#34d399";
  } else if (activeLeftTab === "support") {
    infoTitle = "Support";
    infoAccent = "#818cf8";
  } else if (activeLeftTab === "settings") {
    infoTitle = "Settings";
    infoAccent = "#94a3b8";
  } else if (activeLeftTab === "shared") {
    infoTitle = "Shared";
    infoAccent = "#818cf8";
  } else if (activeLeftTab === "marketplace") {
    infoTitle = "Marketplace";
    infoAccent = "#fb923c";
  } else if (activeLeftTab === "structure") {
    infoTitle = "Structure";
    infoAccent = "#60a5fa";
  } else if (activeLeftTab === "coding") {
    infoTitle = "Coding";
    infoAccent = "#38bdf8";
  } else if (activeLeftTab === "releases") {
    infoTitle = "Releases";
    infoAccent = "#f472b6";
  } else if (activeLeftTab === "agents") {
    infoTitle = "Agents";
    infoAccent = "#a78bfa";
  } else if (activeLeftTab === "users") {
    infoTitle = "Profile";
    infoAccent = "#34d399";
  } else if (activeLeftTab === "tasks") {
    infoTitle = "Tasks";
    infoAccent = "#a78bfa";
  } else if (activeLeftTab === "personal-vault") {
    infoTitle = "Personal Vault";
    infoAccent = "#f87171";
  } else if (activeLeftTab === "notifications") {
    infoTitle = "Notifications";
    infoAccent = "#fb923c";
  } else if (activeLeftTab === "contacts") {
    infoTitle = "Contacts";
    infoAccent = "#38bdf8";
  } else if (activeLeftTab === "dms") {
    infoTitle = "Direct Messages";
    infoAccent = "#38bdf8";
  } else if (activeLeftTab === "channels") {
    infoTitle = "Channels";
    infoAccent = "#38bdf8";
  }

  const isCoding =
    activeLeftTab === "info" && informationNode
      ? informationNode.id.toLowerCase().includes("coding") ||
        informationNode.objectType === "CodingWorkspace"
      : false;

  return (
    <div
      className="pointer-events-auto fixed bottom-4 left-4 z-50 flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/85 p-1 shadow-md backdrop-blur-md"
      role="toolbar"
      aria-label="Minimized windows"
    >
      {showInbox ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Restore Messages"
                onClick={() => {
                  setChatInboxMinimized(false);
                  setChatInboxOpen(true);
                  setActiveFloatingWindow("chat-inbox");
                }}
                className="bg-background/80 shadow-xs"
              />
            }
          >
            <MessageCircleIcon className="size-4 text-sky-400" />
          </TooltipTrigger>
          <TooltipContent side="top">Restore Messages</TooltipContent>
        </Tooltip>
      ) : null}

      {minimizedThreads.map((win) => (
        <Tooltip key={win.id}>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={`Restore ${win.title}`}
                onClick={() => {
                  setChatWindowMinimized(win.id, false);
                  focusChatWindow(win.id);
                  setActiveFloatingWindow(win.id);
                }}
                className="bg-background/80 shadow-xs"
              />
            }
          >
            {win.kind === "agent" ? (
              <BotIcon className="size-4 text-primary" />
            ) : win.kind === "channel" ? (
              <HashIcon className="size-4 text-sky-400" />
            ) : (
              <MessageCircleIcon className="size-4 text-sky-400" />
            )}
          </TooltipTrigger>
          <TooltipContent side="top">Restore {win.title}</TooltipContent>
        </Tooltip>
      ))}

      {showChat ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={`Restore ${chatTitle}`}
                onClick={() => {
                  setPanelMinimized(false);
                  setActiveFloatingWindow("chat");
                }}
                className="bg-background/80 shadow-xs"
              />
            }
          >
            {isDm ? (
              <MessageCircleIcon className="size-4 text-sky-400" />
            ) : (
              <BotIcon className="size-4 text-primary" />
            )}
          </TooltipTrigger>
          <TooltipContent side="top">Restore {chatTitle}</TooltipContent>
        </Tooltip>
      ) : null}

      {showInfo ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={`Restore ${infoTitle}`}
                onClick={() => {
                  setInformationPanelMinimized(false);
                  setActiveFloatingWindow("information");
                }}
                className="bg-background/80 shadow-xs"
              />
            }
          >
            {activeLeftTab === "calendar" ? (
              <CalendarIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "projects" ? (
              <WorkflowIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "knowledge" ? (
              <BookOpenIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "bank" ? (
              <LandmarkIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "vault" ? (
              <ShieldCheckIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "platform-vault" ? (
              <KeyRoundIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "admin" ? (
              <ShieldIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "wiki" ? (
              <BookOpenIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "support" ? (
              <LifeBuoyIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "notifications" ? (
              <BellIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "contacts" ? (
              <UsersIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "dms" ? (
              <MessageCircleIcon className="size-4" style={{ color: infoAccent }} />
            ) : activeLeftTab === "channels" ? (
              <HashIcon className="size-4" style={{ color: infoAccent }} />
            ) : isCoding ? (
              <CodeIcon className="size-4" style={{ color: infoAccent }} />
            ) : informationNode?.kind === "system" ? (
              <LayersIcon className="size-4" style={{ color: infoAccent }} />
            ) : (
              <InfoIcon className="size-4" style={{ color: infoAccent }} />
            )}
          </TooltipTrigger>
          <TooltipContent side="top">Restore {infoTitle}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
