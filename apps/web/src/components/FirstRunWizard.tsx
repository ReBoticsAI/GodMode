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
import { VAULT_PATH } from "@/lib/navigation";

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
  const [step, setStep] = useState(0);
  const [saas, setSaas] = useState(false);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setStep(0);
  }, [activeTenantId, epoch]);

  useEffect(() => {
    if (!open) return;
    void fetchBridgeHealth()
      .then((h) => setSaas(Boolean(h.saas)))
      .catch(() => setSaas(false));
    void fetchOnboardingDetect()
      .then((d) => {
        setLocalModels(d.localModels);
        setOllamaModels(d.ollama.models);
        if (d.localModels[0]) setSelectedModel(d.localModels[0]);
      })
      .catch(() => undefined);
  }, [open, activeTenantId]);

  const finish = async () => {
    await completeOnboarding();
    writeOnboardingCompleted(activeTenantId);
    onFinished();
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

  const openVault = () => {
    onOpenVault();
    navigate(VAULT_PATH);
    toast.message("Add your API key in Vault, then return to Chat when you are ready.");
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
                GodMode Cloud uses your own API keys (BYOK). Open Vault to connect Cursor,
                OpenAI Platform, or Anthropic Console, then come back to finish setup.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                You can also open{" "}
                <Link to={VAULT_PATH} className="text-foreground underline underline-offset-4" onClick={onOpenVault}>
                  Vault
                </Link>{" "}
                from the sidebar later. Reopen this wizard anytime from Settings.
              </p>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => setStep(0)} disabled={loading}>
                Back
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={openVault} disabled={loading}>
                  Open Vault
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void markCloudAndContinue()}
                  disabled={loading}
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
                Run a local GGUF model, use Ollama if detected, or open Vault to add a cloud API
                key.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              {localModels.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <Label>Local GGUF model</Label>
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
                  No .gguf models found in your models directory. Add one or use cloud keys in
                  Vault.
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
                <Button variant="outline" onClick={openVault} disabled={loading}>
                  Open Vault
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
              <DialogTitle>Ready</DialogTitle>
              <DialogDescription>
                {saas
                  ? "Open Chat and talk to Intelligence. Add or change keys anytime in Vault."
                  : "Open Chat and talk to Intelligence. Browse Marketplace for starter packs anytime."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
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
  const onVaultRoute = location.pathname.startsWith(VAULT_PATH);

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
