import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CHAT_WINDOW_TUTORIAL_LINES,
  adminGrantChatUnlock,
  completeChatUnlockTutorial,
  fetchChatUnlockStatus,
  markChatUnlockTutorialStep,
  startChatUnlockCheckout,
  startChatUnlockTutorial,
  type ChatUnlockStatus,
} from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { UnlockCapabilityDialog } from "@/components/UnlockCapabilityDialog";

interface ChatUnlockContextValue {
  status: ChatUnlockStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  canCloseResize: boolean;
  canCreateChat: boolean;
  requestUnlock: (unlockableId: "chat_window" | "chat_create") => void;
}

const ChatUnlockCtx = createContext<ChatUnlockContextValue | null>(null);

const OPEN_DEFAULT: ChatUnlockStatus = {
  canCloseResize: true,
  canCreateChat: true,
  stripeConfigured: false,
  unlockables: [],
};

const CHAT_WINDOW_STEPS = [
  "open_chat",
  "send_message",
  "acknowledge_graph",
  "confirm_controls",
] as const;

function narrate(id: string, text: string) {
  window.dispatchEvent(
    new CustomEvent("godmode:unlock-tutorial-narrate", {
      detail: { id, text },
    })
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function ChatUnlockProvider({ children }: { children: ReactNode }) {
  const { user, authenticated } = useTenant();
  const [status, setStatus] = useState<ChatUnlockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogUnlockableId, setDialogUnlockableId] = useState<
    "chat_window" | "chat_create" | null
  >(null);
  const [dialogMode, setDialogMode] = useState<"choose" | "tutorial">("choose");

  const refresh = useCallback(async () => {
    try {
      const next = await fetchChatUnlockStatus();
      setStatus(next);
    } catch {
      setStatus(OPEN_DEFAULT);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, authenticated, user?.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("unlock") === "success") {
      void refresh();
      params.delete("unlock");
      params.delete("uid");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
    }
  }, [refresh]);

  const requestUnlock = useCallback(
    (unlockableId: "chat_window" | "chat_create") => {
      setDialogMode("choose");
      setDialogUnlockableId(unlockableId);
    },
    []
  );

  const runGuidedChatWindowTutorial = useCallback(async () => {
    await startChatUnlockTutorial("chat_window");
    setDialogUnlockableId(null);
    setDialogMode("choose");

    for (let i = 0; i < CHAT_WINDOW_TUTORIAL_LINES.length; i++) {
      const line = CHAT_WINDOW_TUTORIAL_LINES[i]!;
      narrate(`tutorial-chat-window-${i}`, line);
      const step = CHAT_WINDOW_STEPS[Math.min(i, CHAT_WINDOW_STEPS.length - 1)];
      if (step) {
        await markChatUnlockTutorialStep("chat_window", step).catch(() => undefined);
      }
      if (i < CHAT_WINDOW_TUTORIAL_LINES.length - 1) {
        await sleep(900);
      }
    }
    // Ensure remaining steps marked for server validation.
    for (const step of CHAT_WINDOW_STEPS) {
      await markChatUnlockTutorialStep("chat_window", step).catch(() => undefined);
    }
    await completeChatUnlockTutorial("chat_window").catch(() => undefined);
    await refresh();
  }, [refresh]);

  const value = useMemo<ChatUnlockContextValue>(
    () => ({
      status,
      loading,
      refresh,
      canCloseResize: status?.canCloseResize !== false,
      canCreateChat: status?.canCreateChat !== false,
      requestUnlock,
    }),
    [status, loading, refresh, requestUnlock]
  );

  const unlockable = status?.unlockables.find(
    (u) => u.id === dialogUnlockableId
  );

  useEffect(() => {
    if (dialogUnlockableId && unlockable?.entitled) {
      setDialogUnlockableId(null);
      setDialogMode("choose");
    }
  }, [dialogUnlockableId, unlockable?.entitled]);

  return (
    <ChatUnlockCtx.Provider value={value}>
      {children}
      <UnlockCapabilityDialog
        open={dialogUnlockableId != null}
        unlockable={unlockable ?? null}
        authenticated={authenticated}
        canAdminGrant={Boolean(status?.canAdminGrant)}
        mode={dialogMode}
        onOpenChange={(open) => {
          if (!open) {
            setDialogUnlockableId(null);
            setDialogMode("choose");
          }
        }}
        onStartTutorial={async () => {
          if (!dialogUnlockableId) return;
          if (dialogUnlockableId === "chat_window") {
            await runGuidedChatWindowTutorial();
            return;
          }
          await startChatUnlockTutorial(dialogUnlockableId);
          await refresh();
          setDialogMode("tutorial");
        }}
        onToggleStep={async (step, done) => {
          if (!dialogUnlockableId || !done) return;
          await markChatUnlockTutorialStep(dialogUnlockableId, step);
          await refresh();
        }}
        onCompleteTutorial={async () => {
          if (!dialogUnlockableId) return;
          await completeChatUnlockTutorial(dialogUnlockableId);
          await refresh();
          setDialogUnlockableId(null);
          setDialogMode("choose");
        }}
        onSkipPay={async () => {
          if (!dialogUnlockableId) return;
          const origin = window.location.origin;
          const result = await startChatUnlockCheckout({
            unlockableId: dialogUnlockableId,
            successUrl: `${origin}/?unlock=success&uid=${encodeURIComponent(dialogUnlockableId)}`,
            cancelUrl: `${origin}/?unlock=cancel`,
          });
          window.location.href = result.url;
        }}
        onAdminGrant={async () => {
          const ids = dialogUnlockableId
            ? [dialogUnlockableId]
            : ["chat_window"];
          await adminGrantChatUnlock(ids);
          await refresh();
          setDialogUnlockableId(null);
          setDialogMode("choose");
        }}
      />
    </ChatUnlockCtx.Provider>
  );
}

export function useChatUnlock(): ChatUnlockContextValue {
  const ctx = useContext(ChatUnlockCtx);
  if (!ctx) {
    throw new Error("useChatUnlock must be used within ChatUnlockProvider");
  }
  return ctx;
}

export function useChatUnlockOptional(): ChatUnlockContextValue | null {
  return useContext(ChatUnlockCtx);
}
