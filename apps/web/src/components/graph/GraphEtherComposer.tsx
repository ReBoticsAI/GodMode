import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  ArrowUpIcon,
  BugIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { ensureAgentDm, fetchDmDirectory, sendDmMessage } from "@/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { isChannelAgentId } from "@/lib/focus-chrome";
import { useIntelligence } from "@/lib/intelligence-context";
import { useGraphFocusChip } from "@/lib/use-graph-focus-chip";
import { cn } from "@/lib/utils";

function buildBugReportPrompt(userNote: string): string {
  return [
    "I tapped the Bug pill and attached a screenshot of the current page.",
    "",
    "What looks wrong:",
    userNote.trim(),
    "",
    "Use the Support skill (job 1):",
    "1. Gather any missing expected vs actual / repro in 1–3 short turns (do not file yet).",
    "2. ask_user_choice: Log bug for developers vs Hand off to a coding subagent for a fix PR (we will not merge).",
    "3. On log-only: report_platform_issue with subject/body from my notes and the screenshot (pass images or rely on turn screenshots), return the issue URL, stop.",
    "4. On handoff: report_platform_issue first, then delegate_to_subagent / fork+PR to upstream ReBoticsAI/GodMode linking the issue. Never merge. No secrets or personal emails.",
    "Never call ask_guide_choice, open_guide_surface, or wiki tools for this bug.",
  ].join("\n");
}

/**
 * Cursor-style pill message box anchored bottom-center on the Graph.
 * Agent and conversation replies open IntelligencePanel. The page composer follows chatTarget.
 */
export function GraphEtherComposer({
  className,
  statusChips,
  value,
  onValueChange,
  placeholder = "Ask Intelligence, or filter the Graph…",
  browseActive = false,
  onBrowseEnter,
  onSuggestEnter,
  onSuggestArrow,
  onAskForce,
  onComposerEscape,
  inputRef,
  sendRequestId = 0,
}: {
  className?: string;
  /** Pill chips rendered above the message box (status / quick actions). */
  statusChips?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** When true, Enter prefers browse/suggest pick over sending chat. */
  browseActive?: boolean;
  onBrowseEnter?: () => boolean;
  onSuggestEnter?: () => boolean;
  onSuggestArrow?: (dir: "up" | "down") => void;
  onAskForce?: () => void;
  onComposerEscape?: () => void;
  inputRef?: Ref<HTMLInputElement | null>;
  /** Increment to force-send the current value to Intelligence. */
  sendRequestId?: number;
}) {
  const {
    activeAgentId,
    setActiveAgentId,
    setChatMode,
    openPanel,
    chatTarget,
    setChatTarget,
    dmConversations,
    focusedChatWindowId,
    openChatWindows,
    clearComposerDraft,
    emitDmIncomingMessage,
    refreshDmConversations,
    captureScreenshot,
    setPendingComposerImages,
  } = useIntelligence();
  const [bugCapturing, setBugCapturing] = useState(false);
  const [bugDialogOpen, setBugDialogOpen] = useState(false);
  const [bugScreenshot, setBugScreenshot] = useState<string | null>(null);
  const [bugNote, setBugNote] = useState("");
  const bugNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState(false);
  const workStartedAt = useRef<number | null>(null);
  const [workedLabel, setWorkedLabel] = useState<string | null>(null);

  const focusedWindow = openChatWindows.find((w) => w.id === focusedChatWindowId);

  useEffect(() => {
    if (busy) {
      if (workStartedAt.current == null) workStartedAt.current = Date.now();
      setWorkedLabel("Working…");
      const id = window.setInterval(() => {
        const start = workStartedAt.current;
        if (start == null) return;
        const sec = Math.max(1, Math.round((Date.now() - start) / 1000));
        setWorkedLabel(`Worked for ${sec}s`);
      }, 1000);
      return () => window.clearInterval(id);
    }
    if (workStartedAt.current != null) {
      const sec = Math.max(1, Math.round((Date.now() - workStartedAt.current) / 1000));
      setWorkedLabel(`Worked for ${sec}s`);
      workStartedAt.current = null;
      const clearId = window.setTimeout(() => setWorkedLabel(null), 4000);
      return () => window.clearTimeout(clearId);
    }
    return undefined;
  }, [busy]);

  const postToConversation = useCallback(
    async (conversationId: string, text: string) => {
      const dir = await fetchDmDirectory();
      const cloud = dir.cloudChannels.find((c) => c.id === conversationId);
      const install = dir.installChannels.find((c) => c.id === conversationId);
      const privateConv = dmConversations.find((c) => c.id === conversationId);
      const isPublicChannel = Boolean(cloud || install);

      if (cloud && !dir.cloudLobbyHostedHere) {
        toast.message(
          "Cloud lobby posts from Local are not available yet. Use #local on this install, or open GodMode Cloud."
        );
        return false;
      }

      if (cloud || install) {
        const allowed = cloud
          ? dir.entitlement.ok
          : dir.entitlement.installLocalOk !== false;
        if (!allowed) {
          toast.message(
            cloud
              ? dir.entitlement.reason
              : "Sign in with a full account to post in #local."
          );
          return false;
        }
      } else if (!privateConv) {
        toast.message("Conversation not found on this install.");
        return false;
      }

      const res = await sendDmMessage(conversationId, { bodyText: text });
      emitDmIncomingMessage(res.message, conversationId);
      void refreshDmConversations();

      // @general / @local in a public channel also opens that channel agent's DM.
      if (isPublicChannel) {
        const handles = [
          ...text.matchAll(/@([a-z0-9_]{3,32})\b/gi),
        ].map((m) => m[1]!.toLowerCase());
        const channels = [...dir.installChannels, ...dir.cloudChannels];
        for (const handle of handles) {
          const ch = channels.find((c) => c.slug === handle);
          if (!ch?.agentId || !isChannelAgentId(ch.agentId)) continue;
          try {
            const dm = await ensureAgentDm(ch.agentId);
            setChatTarget({
              kind: "conversation",
              conversationId: dm.conversation.id,
            });
            setActiveAgentId(ch.agentId, { retainChatTarget: true });
            void refreshDmConversations();
            toast.message(`Opened DM with ${ch.displayTitle}`);
          } catch {
            /* mention still posted in-channel; DM open is best-effort */
          }
          break;
        }
      }
      return true;
    },
    [
      dmConversations,
      emitDmIncomingMessage,
      refreshDmConversations,
      setActiveAgentId,
      setChatTarget,
    ]
  );

  const send = useCallback(() => {
    const text = value.trim();
    if (!text || busy) return;

    if (chatTarget.kind === "conversation") {
      const conversationId = chatTarget.conversationId;
      setBusy(true);
      openPanel({ tab: "chat" });
      void (async () => {
        try {
          const ok = await postToConversation(conversationId, text);
          if (!ok) return;
          onValueChange("");
          clearComposerDraft(focusedChatWindowId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to send";
          toast.error(msg);
          setWorkedLabel(msg);
          window.setTimeout(() => setWorkedLabel(null), 4000);
        } finally {
          setBusy(false);
        }
      })();
      return;
    }

    const agentId =
      focusedWindow?.kind === "agent" && focusedWindow.agentId
        ? focusedWindow.agentId
        : chatTarget.kind === "agent"
          ? chatTarget.agentId
          : activeAgentId;

    // Channel agents are 1:1 DMs (same as Agents → #general / @general).
    if (isChannelAgentId(agentId)) {
      setBusy(true);
      openPanel({ tab: "chat" });
      void (async () => {
        try {
          const res = await ensureAgentDm(agentId);
          setChatTarget({
            kind: "conversation",
            conversationId: res.conversation.id,
          });
          setActiveAgentId(agentId, { retainChatTarget: true });
          const ok = await postToConversation(res.conversation.id, text);
          if (!ok) return;
          onValueChange("");
          clearComposerDraft(focusedChatWindowId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to send";
          toast.error(msg);
          setWorkedLabel(msg);
          window.setTimeout(() => setWorkedLabel(null), 4000);
        } finally {
          setBusy(false);
        }
      })();
      return;
    }

    onValueChange("");
    clearComposerDraft(focusedChatWindowId);

    // Agent replies stream in IntelligencePanel; Graph ether is the composer.
    openPanel({
      agentId,
      tab: "chat",
      prompt: text,
      autoSend: true,
    });
  }, [
    activeAgentId,
    busy,
    chatTarget,
    clearComposerDraft,
    focusedChatWindowId,
    focusedWindow,
    onValueChange,
    openPanel,
    postToConversation,
    setActiveAgentId,
    setChatTarget,
    value,
  ]);

  const sendRequestSeen = useRef(0);
  useEffect(() => {
    if (!sendRequestId || sendRequestId === sendRequestSeen.current) return;
    sendRequestSeen.current = sendRequestId;
    send();
  }, [sendRequestId, send]);

  const handlePrimaryAction = useCallback(() => {
    if (onSuggestEnter?.()) return;
    if (browseActive && onBrowseEnter?.()) return;
    send();
  }, [browseActive, onBrowseEnter, onSuggestEnter, send]);

  const handleAskForce = useCallback(() => {
    if (onAskForce) {
      onAskForce();
      return;
    }
    send();
  }, [onAskForce, send]);

  const hasText = value.trim().length > 0;
  const focusChip = useGraphFocusChip();
  const FocusIcon = focusChip?.Icon;
  const leftChips = Boolean(statusChips || workedLabel || focusChip);

  const handleBugReport = useCallback(async () => {
    if (bugCapturing || bugDialogOpen) return;
    setBugCapturing(true);
    try {
      const shot = await captureScreenshot();
      if (!shot) {
        toast.error("Could not capture screenshot");
        return;
      }
      setBugScreenshot(shot);
      setBugNote("");
      setBugDialogOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Screenshot failed");
    } finally {
      setBugCapturing(false);
    }
  }, [bugCapturing, bugDialogOpen, captureScreenshot]);

  useEffect(() => {
    if (!bugDialogOpen) return;
    const id = window.setTimeout(() => bugNoteRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [bugDialogOpen]);

  const closeBugDialog = useCallback(() => {
    setBugDialogOpen(false);
    setBugScreenshot(null);
    setBugNote("");
  }, []);

  const submitBugReport = useCallback(() => {
    const note = bugNote.trim();
    if (note.length < 8) {
      toast.error("Describe what looks wrong (a short sentence is enough)");
      bugNoteRef.current?.focus();
      return;
    }
    if (!bugScreenshot) {
      toast.error("Screenshot missing. Tap Bug again.");
      closeBugDialog();
      return;
    }
    setPendingComposerImages([bugScreenshot]);
    openPanel({
      tab: "chat",
      agentId: "intelligence",
      prompt: buildBugReportPrompt(note),
      autoSend: true,
    });
    closeBugDialog();
    toast.message("Filing bug report…");
  }, [
    bugNote,
    bugScreenshot,
    closeBugDialog,
    openPanel,
    setPendingComposerImages,
  ]);

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <Dialog
        open={bugDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeBugDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report a bug</DialogTitle>
            <DialogDescription>
              Screenshot captured. Describe what looks wrong so Intelligence can
              file a clear GitHub issue.
            </DialogDescription>
          </DialogHeader>
          {bugScreenshot ? (
            <div className="overflow-hidden rounded-md border border-border">
              <img
                src={bugScreenshot}
                alt="Bug screenshot preview"
                className="max-h-40 w-full object-cover object-top"
              />
            </div>
          ) : null}
          <Field>
            <FieldLabel htmlFor="bug-report-note">What looks wrong?</FieldLabel>
            <Textarea
              ref={bugNoteRef}
              id="bug-report-note"
              value={bugNote}
              onChange={(e) => setBugNote(e.target.value)}
              placeholder="Expected vs actual, and how to reproduce if you know."
              rows={4}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitBugReport();
                }
              }}
            />
            <FieldDescription>
              Do not include secrets or personal emails. Ctrl/Cmd+Enter to submit.
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeBugDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitBugReport}
              disabled={bugNote.trim().length < 8}
            >
              File report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        className="flex shrink-0 items-center gap-1.5"
        data-graph-action-chrome=""
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {focusChip && FocusIcon ? (
            <span
              className={cn(
                "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs shadow-sm backdrop-blur-sm",
                focusChip.mode === "replying"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/50 bg-card/80 text-muted-foreground"
              )}
              title={
                focusChip.mode === "replying"
                  ? `Replying to ${focusChip.label}`
                  : `Focused on ${focusChip.label}`
              }
            >
              <FocusIcon
                className="size-3.5 shrink-0"
                style={{ color: focusChip.accent }}
                aria-hidden
              />
              <span className="truncate">
                {focusChip.mode === "replying"
                  ? `Replying to ${focusChip.label}`
                  : `Focused on ${focusChip.label}`}
              </span>
            </span>
          ) : null}
          {workedLabel ? (
            <span className="inline-flex h-7 items-center rounded-full border border-border/50 bg-card/80 px-2.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
              {workedLabel}
            </span>
          ) : null}
          {statusChips}
          {!leftChips ? <span className="sr-only">Composer actions</span> : null}
        </div>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs shadow-sm backdrop-blur-sm transition-colors",
            "border-border/50 bg-card/80 text-muted-foreground",
            "hover:bg-muted hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-50"
          )}
          aria-label="Report a bug with screenshot"
          title="Report a bug (captures screenshot, then asks what looks wrong)"
          disabled={bugCapturing || bugDialogOpen}
          onClick={() => void handleBugReport()}
        >
          <BugIcon className="size-3.5 shrink-0" aria-hidden />
          <span>{bugCapturing ? "Capturing…" : "Bug"}</span>
        </button>
      </div>

      <div className="flex shrink-0" data-graph-action-chrome="">
        <InputGroup
          className={cn(
            // Solid elevated surface. InputGroup's has-disabled:* greys the whole
            // pill when the empty send button is disabled; override that.
            "h-12 min-w-0 flex-1 rounded-full border-border bg-card shadow-md",
            "dark:bg-card",
            "has-disabled:opacity-100 has-disabled:bg-card",
            "dark:has-disabled:bg-card",
            "has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-2"
          )}
        >
          <InputGroupAddon align="inline-start" className="pl-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Add context"
                    className="size-8 rounded-full text-foreground/80 hover:bg-muted hover:text-foreground"
                  />
                }
              >
                <PlusIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel>Compose</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    setChatMode("ask");
                    handleAskForce();
                  }}
                >
                  <SparklesIcon />
                  Ask Intelligence
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => openPanel({ tab: "chat" })}
                >
                  Open Intelligence panel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    onValueChange(value || "create ");
                  }}
                >
                  Type an action…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </InputGroupAddon>

          <InputGroupInput
            ref={inputRef}
            data-graph-ether-composer=""
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground"
            placeholder={placeholder}
            value={value}
            disabled={busy && !browseActive}
            aria-label="Search Graph, browse actions, or ask Intelligence"
            aria-autocomplete="list"
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onComposerEscape?.();
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                onSuggestArrow?.("down");
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                onSuggestArrow?.("up");
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.ctrlKey || e.metaKey) {
                  handleAskForce();
                  return;
                }
                handlePrimaryAction();
              }
            }}
          />

          <InputGroupAddon align="inline-end" className="gap-1 pr-1.5">
            <Button
              type="button"
              size="icon-sm"
              variant="default"
              disabled={busy || !hasText}
              aria-label={
                browseActive ? "Select match or send" : "Send message"
              }
              onClick={handlePrimaryAction}
              className="size-8 rounded-full disabled:opacity-70"
            >
              <ArrowUpIcon />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
}
