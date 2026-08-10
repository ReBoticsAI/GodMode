import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  completeOnboarding,
  fetchAiSecrets,
  fetchBridgeHealth,
  fetchOnboardingDetect,
  fetchOnboardingStatus,
  markOnboardingCloudReady,
  resetOnboarding,
  startOnboardingLocalLlm,
} from "@/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  clearOnboardingCompleted,
  writeOnboardingCompleted,
} from "@/lib/storage-keys";
import { useTenant } from "@/lib/tenant-context";
import {
  HOME_PATH,
  SETTINGS_PATH,
  VAULT_PATH,
} from "@/lib/navigation";
import { useIntelligence } from "@/lib/intelligence-context";
import { EXA_API_KEY_SECRET_NAME } from "@/pages/ai-settings/ExaConnectCard";
import { platformVaultSettingsHref } from "@/pages/Vault";

type Props = {
  open: boolean;
  /** Bumps when Settings reopens the wizard so steps reset. */
  epoch: number;
  onFinished: () => void;
  /** Soft-dismiss so Vault is usable; onboarding stays incomplete. */
  onOpenVault: () => void;
};

export function FirstRunWizard({ open, epoch, onFinished, onOpenVault }: Props) {
  const { activeTenantId } = useTenant();
  const navigate = useNavigate();
  const { openPanel } = useIntelligence();
  const [step, setStep] = useState(0);
  const [saas, setSaas] = useState(false);
  const [llmReady, setLlmReady] = useState(false);
  const [exaConnected, setExaConnected] = useState(false);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setStep(0);
  }, [activeTenantId, epoch]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      let isSaas = false;
      try {
        const h = await fetchBridgeHealth();
        isSaas = Boolean(h.saas);
      } catch {
        isSaas = false;
      }
      if (cancelled) return;
      setSaas(isSaas);

      try {
        const { secrets } = await fetchAiSecrets({ ownerKind: "platform" });
        if (!cancelled) {
          setExaConnected(
            secrets.some((s) => s.name.toLowerCase() === EXA_API_KEY_SECRET_NAME)
          );
        }
      } catch {
        if (!cancelled) setExaConnected(false);
      }

      if (isSaas) {
        try {
          const s = await fetchOnboardingStatus();
          if (!cancelled) setLlmReady(Boolean(s.llmReady));
        } catch {
          if (!cancelled) setLlmReady(false);
        }
        return;
      }

      try {
        const s = await fetchOnboardingStatus();
        if (!cancelled) setLlmReady(Boolean(s.llmReady));
      } catch {
        /* local status is best-effort for badge refresh */
      }

      try {
        const d = await fetchOnboardingDetect();
        if (cancelled) return;
        setLocalModels(d.localModels);
        setOllamaModels(d.ollama.models);
        if (d.localModels[0]) setSelectedModel(d.localModels[0]);
      } catch {
        /* local detect is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeTenantId, epoch]);

  const finish = async () => {
    await completeOnboarding();
    writeOnboardingCompleted(activeTenantId);
    onFinished();
    navigate(HOME_PATH);
    openPanel({ tab: "chat" });
  };

  const startLocal = async () => {
    if (!selectedModel) {
      toast.error("Pick a model first");
      return;
    }
    setLoading(true);
    try {
      await startOnboardingLocalLlm(selectedModel);
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start model");
    } finally {
      setLoading(false);
    }
  };

  const openPlatformVault = (sub: "subscriptions" | "api-keys" | "search" = "api-keys") => {
    onOpenVault();
    navigate(platformVaultSettingsHref(sub));
    toast.message(
      sub === "search"
        ? "Add your Exa key in Platform Vault → Search, then return to finish setup."
        : "Add your API key in Platform Vault, then return to finish setup."
    );
  };

  const markCloudAndContinue = async () => {
    setLoading(true);
    try {
      await markOnboardingCloudReady();
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const continueSaas = async () => {
    setLoading(true);
    try {
      const s = await fetchOnboardingStatus();
      setLlmReady(Boolean(s.llmReady));
      if (!s.llmReady) {
        toast.error("Connect an API key in Platform Vault before continuing.");
        return;
      }
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not check LLM status");
    } finally {
      setLoading(false);
    }
  };

  const continueExa = async () => {
    setLoading(true);
    try {
      const { secrets } = await fetchAiSecrets({ ownerKind: "platform" });
      setExaConnected(
        secrets.some((s) => s.name.toLowerCase() === EXA_API_KEY_SECRET_NAME)
      );
    } catch {
      /* optional; do not block */
    } finally {
      setLoading(false);
      setStep(3);
    }
  };

  // Hard-unmount when closed so Base UI portal/overlay cannot linger over Vault.
  if (!open) return null;

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        {step === 0 ? (
          <>
            <DialogHeader>
              <DialogTitle>Welcome to GodMode</DialogTitle>
              <DialogDescription>
                {saas
                  ? "Connect an LLM so Intelligence can respond from your first chat."
                  : "Set up an LLM so Intelligence can respond from your first chat."}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              GodMode is your Control Center: create, edit, organize, and monitor your work
              with structure, agents, wiki, tasks, and automations in one place.
            </p>
            <DialogFooter>
              <Button onClick={() => setStep(1)}>Continue</Button>
            </DialogFooter>
          </>
        ) : null}

        {step === 1 && saas ? (
          <>
            <DialogHeader>
              <DialogTitle>Connect your LLM</DialogTitle>
              <DialogDescription>
                Choose a subscription (use your plan: Cursor, Z.AI GLM Coding Plan,
                OpenCode Go, OpenCode Zen, MiniMax Token Plan, Kimi Code, or Poe) or a metered
                Platform API key (OpenAI, Anthropic, OpenRouter, Groq, Together, Fireworks,
                DeepSeek, Google AI Studio, xAI, Z.AI, MiniMax, or a custom
                OpenAI-compatible endpoint). Open Platform Vault to connect, then come back to finish
                setup.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="text-foreground">Status</span>
                <Badge variant={llmReady ? "default" : "outline"}>
                  {llmReady ? "Connected" : "Not connected"}
                </Badge>
              </div>
              <p>
                Subscriptions bill through the provider. Platform API keys are metered BYOK and
                apply a provider harness in Intelligence. You can also open{" "}
                <Link
                  to={platformVaultSettingsHref("api-keys")}
                  className="text-foreground underline underline-offset-4"
                  onClick={onOpenVault}
                >
                  Platform Vault
                </Link>{" "}
                from the sidebar later. Reopen this wizard anytime from Settings.
              </p>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => setStep(0)} disabled={loading}>
                Back
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => openPlatformVault("api-keys")} disabled={loading}>
                  Open Platform Vault
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void continueSaas()}
                  disabled={loading || !llmReady}
                >
                  Continue
                </Button>
                <Button variant="ghost" onClick={() => void finish()} disabled={loading}>
                  Skip for now
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : null}

        {step === 1 && !saas ? (
          <>
            <DialogHeader>
              <DialogTitle>Choose your LLM</DialogTitle>
              <DialogDescription>
                Local installs use llama.cpp as the primary stack (GGUF models). Ollama and LM
                Studio are additional options. You can also open Platform Vault to add a
                cloud API key.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              {localModels.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <Label>Local GGUF model (llama.cpp)</Label>
                  <Select
                    value={selectedModel}
                    onValueChange={(v) => setSelectedModel(v ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {localModels.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No .gguf models found in your models directory. Add one, or use cloud keys in
                  Platform Vault. Ollama and LM Studio connect flows are coming as
                  additional local backends.
                </p>
              )}
              {ollamaModels.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Ollama detected: {ollamaModels.slice(0, 3).join(", ")}
                  {ollamaModels.length > 3 ? "…" : ""}
                </p>
              ) : null}
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => setStep(0)} disabled={loading}>
                Back
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                {localModels.length > 0 ? (
                  <Button onClick={() => void startLocal()} disabled={loading}>
                    Start local model
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => openPlatformVault("api-keys")}
                  disabled={loading}
                >
                  Open Platform Vault
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void markCloudAndContinue()}
                  disabled={loading}
                >
                  I already added a key
                </Button>
                <Button variant="ghost" onClick={() => void finish()} disabled={loading}>
                  Skip for now
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <DialogHeader>
              <DialogTitle>Connect Exa (optional)</DialogTitle>
              <DialogDescription>
                Exa powers web search and URL fetch for agents. Add a key in Settings → Platform
                Vault when you want
                agents to search the live web. You can skip this and continue.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="text-foreground">Status</span>
                <Badge variant={exaConnected ? "default" : "outline"}>
                  {exaConnected ? "Connected" : "Not connected"}
                </Badge>
              </div>
              <p>
                Create a key at the Exa dashboard, then connect it under{" "}
                <Link
                  to={platformVaultSettingsHref("search")}
                  className="text-foreground underline underline-offset-4"
                  onClick={onOpenVault}
                >
                  Platform Vault → Search
                </Link>
                . Self-host may fall back without Exa; Cloud prefers a tenant Exa key for web
                tools.
              </p>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => setStep(1)} disabled={loading}>
                Back
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => openPlatformVault("search")} disabled={loading}>
                  Open Platform Vault
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void continueExa()}
                  disabled={loading}
                >
                  Continue
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <DialogHeader>
              <DialogTitle>Ready</DialogTitle>
              <DialogDescription>
                {saas
                  ? "Open Chat and talk to Intelligence. Add or change keys anytime in Platform Vault."
                  : "Open Chat and talk to Intelligence. Browse Marketplace for starter packs anytime."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={() => void finish()}>Get started</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type OnboardingWizardControl = {
  reopenWizard: () => Promise<void>;
};

const OnboardingWizardControlContext = createContext<OnboardingWizardControl | null>(null);

export function useOnboardingWizardControl(): OnboardingWizardControl | null {
  return useContext(OnboardingWizardControlContext);
}

/**
 * Show FirstRunWizard when the active workspace has neither completed onboarding
 * nor marked an LLM ready.
 *
 * SaaS email-verify (and admin MFA) gates block `/onboarding/status` with 403.
 * Swallowing that as `needsWizard=false` without re-checking after verify left
 * new Cloud tenants on an empty Home with no wizard. Re-run when auth gates clear.
 *
 * Soft-dismiss (Open Vault) pauses the modal so Vault is usable; leaving Vault
 * while still incomplete brings the wizard back. Settings can force-reopen.
 */
export function useOnboardingGate() {
  const { authenticated, activeTenantId, user } = useTenant();
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [needsWizard, setNeedsWizard] = useState(false);
  const [forceShow, setForceShow] = useState(false);
  const [pausedForVault, setPausedForVault] = useState(false);
  const [wizardEpoch, setWizardEpoch] = useState(0);
  /** Prevents clearing pause before navigate(/vault) commits (race that left modal stuck). */
  const visitedVaultWhilePaused = useRef(false);

  const emailGateOpen = Boolean(
    authenticated && user && user.emailVerified === false && user.isAdmin !== true
  );
  const mfaGateOpen = Boolean(
    authenticated && user?.isAdmin && user.mfaEnabled === false
  );
  const authProductGateOpen = emailGateOpen || mfaGateOpen;
  const onVaultRoute =
    location.pathname.startsWith(VAULT_PATH) ||
    (location.pathname.startsWith(SETTINGS_PATH) &&
      new URLSearchParams(location.search).has("vault"));

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const s = await fetchOnboardingStatus();
      setNeedsWizard(!s.completed && !s.llmReady);
    } catch {
      // Do not permanently dismiss: callers re-invoke when gates clear.
      setNeedsWizard(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setNeedsWizard(false);
      setChecking(false);
      setForceShow(false);
      setPausedForVault(false);
      visitedVaultWhilePaused.current = false;
      return;
    }
    if (authProductGateOpen) {
      // Avoid 403 EMAIL_NOT_VERIFIED / MFA_SETUP_REQUIRED probing product APIs.
      setNeedsWizard(false);
      setChecking(false);
      return;
    }
    if (!activeTenantId) {
      // Authenticated with zero workspaces: NoWorkspaceGate handles recovery.
      setNeedsWizard(false);
      setChecking(false);
      return;
    }
    void refresh();
  }, [
    authenticated,
    activeTenantId,
    authProductGateOpen,
    user?.emailVerified,
    user?.mfaEnabled,
    user?.isAdmin,
    refresh,
  ]);

  // After Open Vault, resume the wizard once the user leaves Vault (if still incomplete).
  // Do not clear pause until we have observed /vault: navigate is async and the old
  // pathname would otherwise clear pause immediately and leave the dialog stuck open.
  // Intentionally do not refresh gate status here: llmReady alone would dismiss the
  // wizard before Continue / Get started. FirstRunWizard refreshes llmReady for the badge.
  useEffect(() => {
    if (!pausedForVault) {
      visitedVaultWhilePaused.current = false;
      return;
    }
    if (onVaultRoute) {
      visitedVaultWhilePaused.current = true;
      return;
    }
    if (!visitedVaultWhilePaused.current) return;
    visitedVaultWhilePaused.current = false;
    setPausedForVault(false);
  }, [onVaultRoute, pausedForVault]);

  // Hide on Vault route even if pause raced; Soft-dismiss also hides before navigate lands.
  const openWizard =
    forceShow || (needsWizard && !pausedForVault && !onVaultRoute);

  const onFinished = useCallback(() => {
    setForceShow(false);
    setPausedForVault(false);
    visitedVaultWhilePaused.current = false;
    void refresh();
  }, [refresh]);

  const onOpenVault = useCallback(() => {
    setPausedForVault(true);
    setForceShow(false);
  }, []);

  const reopenWizard = useCallback(async () => {
    setPausedForVault(false);
    visitedVaultWhilePaused.current = false;
    setForceShow(true);
    setWizardEpoch((n) => n + 1);
    try {
      await resetOnboarding();
      clearOnboardingCompleted(activeTenantId);
      await refresh();
      toast.success("Onboarding wizard reopened");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reopen onboarding");
      setForceShow(false);
    }
  }, [activeTenantId, refresh]);

  const control = useMemo(() => ({ reopenWizard }), [reopenWizard]);

  return {
    checking,
    needsWizard: openWizard,
    wizardEpoch,
    refresh,
    onFinished,
    onOpenVault,
    control,
  };
}

export function OnboardingWizardProvider({
  control,
  children,
}: {
  control: OnboardingWizardControl;
  children: ReactNode;
}) {
  return (
    <OnboardingWizardControlContext.Provider value={control}>
      {children}
    </OnboardingWizardControlContext.Provider>
  );
}
