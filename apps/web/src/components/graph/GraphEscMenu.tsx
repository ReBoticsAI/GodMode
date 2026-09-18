import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  KeyboardIcon,
  MoonIcon,
  PlayIcon,
  RotateCcwIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useTenant } from "@/lib/tenant-context";

export interface EscMenuCustomAction {
  id: string;
  label: string;
  description?: string;
  icon?: ComponentType<{ className?: string; "data-icon"?: string }>;
  badge?: string;
  disabled?: boolean;
  onSelect?: () => void;
  href?: string;
}

/**
 * Declarative custom items slot: operators and developers can add new
 * menu options, tools, external links, or commands here.
 *
 * Each item supports:
 * - id: unique string identifier
 * - label: display name
 * - description: optional helper copy
 * - icon: Lucide icon component
 * - badge: optional status or category tag
 * - disabled: optional boolean
 * - onSelect: callback function invoked when clicked
 * - href: optional URL (opens in new tab or current window)
 */
export const DEFAULT_CUSTOM_ACTIONS: EscMenuCustomAction[] = [
  // Add your custom actions, tools, and commands here.
];

export interface GraphEscMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  customActions?: EscMenuCustomAction[];
  className?: string;
}

function isTypingElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable
  );
}

function isOtherOverlayActive(): boolean {
  // Guard 1: Any native open dialog or native popover that is not our Esc menu
  const nativeDialog = document.querySelector(
    "dialog[open]:not([data-graph-esc-menu])"
  );
  if (nativeDialog) return true;

  try {
    const nativePopover = document.querySelector(
      ":popover-open:not([data-graph-esc-menu])"
    );
    if (nativePopover) return true;
  } catch {
    // Selector might not be supported in older test environments
  }

  // Guard 2: Any open Base UI / Radix dialog, sheet, dropdown menu, or select
  const overlay = document.querySelector(
    '[data-slot="dialog-content"]:not([data-graph-esc-menu]), ' +
      '[data-slot="sheet-content"]:not([data-graph-esc-menu]), ' +
      '[data-slot="dropdown-menu-content"], ' +
      '[data-slot="select-content"], ' +
      '[data-slot="popover-content"], ' +
      '[data-slot="alert-dialog-content"], ' +
      '[data-slot="graph-action-browse"], ' +
      '[role="dialog"]:not([data-graph-esc-menu]), ' +
      '[role="menu"]:not([data-graph-esc-menu]), ' +
      '[role="listbox"][data-graph-action-browse], ' +
      '[role="alertdialog"]:not([data-graph-esc-menu])'
  );

  return Boolean(overlay);
}

export function GraphEscMenu({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  customActions,
  className,
}: GraphEscMenuProps = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const setIsOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(next);
      }
      controlledOnOpenChange?.(next);
    },
    [isControlled, controlledOnOpenChange]
  );

  const navigate = useNavigate();
  const { authenticated, user } = useTenant();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  // Global Escape key listener with safety guards
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      // If the Esc menu is already open, pressing Escape closes it
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        return;
      }

      // If an existing component already prevented default, ignore
      if (event.defaultPrevented) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const target = event.target as HTMLElement | null;

      // 1. If user is typing in an input, textarea, or contentEditable, blur it
      // rather than opening the Esc menu
      if (isTypingElement(active) || isTypingElement(target)) {
        (active ?? target)?.blur();
        return;
      }

      // 2. If a native dialog, sheet, dropdown, or popover is already open,
      // let Escape close that existing overlay rather than opening the Esc menu
      if (isOtherOverlayActive()) {
        return;
      }

      // 3. Otherwise, canvas / background / UI is focused: toggle the Esc menu open
      event.preventDefault();
      setIsOpen(true);
    };

    const handleOpen = () => setIsOpen(true);
    const handleClose = () => setIsOpen(false);
    const handleToggle = () => setIsOpen(!isOpen);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("godmode:open-esc-menu", handleOpen);
    window.addEventListener("godmode:close-esc-menu", handleClose);
    window.addEventListener("godmode:toggle-esc-menu", handleToggle);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("godmode:open-esc-menu", handleOpen);
      window.removeEventListener("godmode:close-esc-menu", handleClose);
      window.removeEventListener("godmode:toggle-esc-menu", handleToggle);
    };
  }, [isOpen, setIsOpen]);

  const handleResume = () => {
    setIsOpen(false);
  };

  const handleSettings = () => {
    setIsOpen(false);
    navigate("/settings");
  };

  const handleAccount = () => {
    setIsOpen(false);
    if (authenticated) {
      navigate("/users");
    } else {
      navigate("/?auth=1");
    }
  };

  const handleResetGraph = () => {
    try {
      window.dispatchEvent(new CustomEvent("godmode:reset-graph-view"));
      toast.success("Graph view reset");
    } catch {
      /* ignore */
    }
    setIsOpen(false);
  };

  const handleToggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

  const allCustomActions = [
    ...DEFAULT_CUSTOM_ACTIONS,
    ...(customActions ?? []),
  ];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent
        data-graph-esc-menu="true"
        className={
          className ??
          "max-h-[88vh] overflow-y-auto border-border/80 bg-background/95 p-5 backdrop-blur-md sm:max-w-md"
        }
      >
        <DialogHeader className="gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <DialogTitle className="font-heading text-lg font-semibold tracking-tight">
                System Menu
              </DialogTitle>
              <Badge variant="outline" className="font-mono text-[10px]">
                GRAPH
              </Badge>
            </div>
            <Badge variant="secondary" className="font-mono text-[10px]">
              ESC
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            GodMode control surface and quick navigation
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 pt-1">
          {/* Primary Resume Action */}
          <Button
            type="button"
            size="lg"
            variant="default"
            className="w-full justify-between shadow-sm"
            onClick={handleResume}
          >
            <span className="flex items-center gap-2">
              <PlayIcon data-icon="inline-start" />
              Return to Graph
            </span>
            <Badge
              variant="secondary"
              className="bg-primary-foreground/20 font-mono text-[10px] text-primary-foreground"
            >
              Resume
            </Badge>
          </Button>

          <Separator />

          {/* Core Controls */}
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-between px-3 py-2.5 text-left"
              onClick={handleSettings}
            >
              <div className="flex items-center gap-2.5">
                <SettingsIcon
                  data-icon="inline-start"
                  className="text-muted-foreground"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Settings</span>
                  <span className="text-xs text-muted-foreground">
                    Preferences, AI configuration, and keys
                  </span>
                </div>
              </div>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-between px-3 py-2.5 text-left"
              onClick={handleAccount}
            >
              <div className="flex items-center gap-2.5">
                <UserIcon
                  data-icon="inline-start"
                  className="text-muted-foreground"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {authenticated
                      ? user?.displayName || user?.email || "Account & Profile"
                      : "Account & Profile"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {authenticated
                      ? "Manage identity and sessions"
                      : "Sign in or authenticate"}
                  </span>
                </div>
              </div>
              <Badge
                variant={authenticated ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {authenticated ? "Signed in" : "Sign in"}
              </Badge>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-between px-3 py-2.5 text-left"
              onClick={handleResetGraph}
            >
              <div className="flex items-center gap-2.5">
                <RotateCcwIcon
                  data-icon="inline-start"
                  className="text-muted-foreground"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Reset Graph View</span>
                  <span className="text-xs text-muted-foreground">
                    Recenter 3D camera and default zoom
                  </span>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">
                Recenter
              </Badge>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-between px-3 py-2.5 text-left"
              onClick={handleToggleTheme}
            >
              <div className="flex items-center gap-2.5">
                {isDark ? (
                  <SunIcon
                    data-icon="inline-start"
                    className="text-muted-foreground"
                  />
                ) : (
                  <MoonIcon
                    data-icon="inline-start"
                    className="text-muted-foreground"
                  />
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Appearance</span>
                  <span className="text-xs text-muted-foreground">
                    {isDark ? "Dark theme active" : "Light theme active"}
                  </span>
                </div>
              </div>
              <Badge variant="secondary" className="text-[10px]">
                {isDark ? "Switch to light" : "Switch to dark"}
              </Badge>
            </Button>
          </div>

          <Separator />

          {/* Keyboard Shortcuts Section */}
          <Card size="sm" className="bg-muted/30">
            <CardHeader className="px-3 pt-2 pb-1">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <KeyboardIcon className="size-3.5" />
                  Keyboard Shortcuts
                </CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px] text-muted-foreground"
                  onClick={() => setShortcutsOpen(!shortcutsOpen)}
                >
                  {shortcutsOpen ? "Hide" : "Show"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-3 pt-1 pb-2">
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Pan 3D Camera</span>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      W A S D
                    </Badge>
                    <span className="text-muted-foreground">or</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      Arrows
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Elevation Up / Down</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    Q / E
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Activate Node</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    Enter
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Collapse Branch</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    C
                  </Badge>
                </div>
                {shortcutsOpen && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Toggle Intelligence
                      </span>
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        Ctrl+L / Cmd+L
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Toggle System Menu
                      </span>
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        Esc
                      </Badge>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Custom Actions Slot */}
          {allCustomActions.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-col gap-1.5">
                <div className="px-1 text-xs font-semibold text-muted-foreground">
                  Custom Tools & Actions
                </div>
                {allCustomActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Button
                      key={action.id}
                      type="button"
                      variant="outline"
                      disabled={action.disabled}
                      className="h-auto w-full justify-between px-3 py-2 text-left"
                      onClick={() => {
                        if (action.href) {
                          window.open(action.href, "_blank");
                        }
                        action.onSelect?.();
                        setIsOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-2.5">
                        {Icon && (
                          <Icon
                            data-icon="inline-start"
                            className="text-muted-foreground"
                          />
                        )}
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {action.label}
                          </span>
                          {action.description && (
                            <span className="text-xs text-muted-foreground">
                              {action.description}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {action.badge && (
                          <Badge variant="secondary" className="text-[10px]">
                            {action.badge}
                          </Badge>
                        )}
                        {action.href && (
                          <ExternalLinkIcon className="size-3 text-muted-foreground" />
                        )}
                      </div>
                    </Button>
                  );
                })}
              </div>
            </>
          )}

          <p className="pt-1 text-center text-[11px] text-muted-foreground">
            Press Escape or click outside to resume.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
