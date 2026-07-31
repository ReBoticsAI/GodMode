import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  completeOnboarding,
  fetchBridgeHealth,
  fetchOnboardingDetect,
  fetchOnboardingStatus,
  markOnboardingCloudReady,
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
import { writeOnboardingCompleted } from "@/lib/storage-keys";
import { useTenant } from "@/lib/tenant-context";
import { VAULT_PATH } from "@/lib/navigation";

type Props = {
  open: boolean;
  onFinished: () => void;
};

export function FirstRunWizard({ open, onFinished }: Props) {
  const { activeTenantId } = useTenant();
  const [step, setStep] = useState(0);
  const [saas, setSaas] = useState(false);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
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

  const useCloud = async () => {
    setLoading(true);
    try {
      await markOnboardingCloudReady();
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent className="sm:max-w-lg">
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
                GodMode Cloud uses your own API keys (BYOK). Add a Cursor subscription key or a
                cloud provider key in Vault, then continue.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                Open{" "}
                <Link to={VAULT_PATH} className="text-foreground underline underline-offset-4">
                  Vault
                </Link>{" "}
                to connect Cursor or store OpenAI / Anthropic secrets. You can finish this step
                now and add keys before your first chat.
              </p>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button onClick={() => void useCloud()} disabled={loading}>
                Continue with Vault
              </Button>
              <Button variant="ghost" onClick={() => void finish()} disabled={loading}>
                Skip for now
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === 1 && !saas ? (
          <>
            <DialogHeader>
              <DialogTitle>Choose your LLM</DialogTitle>
              <DialogDescription>
                Run a local GGUF model, use Ollama if detected, or skip and add a cloud API key in
                Vault later.
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
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              {localModels.length > 0 ? (
                <Button onClick={() => void startLocal()} disabled={loading}>
                  Start local model
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void useCloud()} disabled={loading}>
                Use cloud API (Vault)
              </Button>
              <Button variant="ghost" onClick={() => void finish()} disabled={loading}>
                Skip for now
              </Button>
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
            <DialogFooter>
              <Button onClick={() => void finish()}>Get started</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Show FirstRunWizard when the active workspace has neither completed onboarding
 * nor marked an LLM ready.
 *
 * SaaS email-verify (and admin MFA) gates block `/onboarding/status` with 403.
 * Swallowing that as `needsWizard=false` without re-checking after verify left
 * new Cloud tenants on an empty Home with no wizard. Re-run when auth gates clear.
 */
export function useOnboardingGate() {
  const { authenticated, activeTenantId, user } = useTenant();
  const [checking, setChecking] = useState(true);
  const [needsWizard, setNeedsWizard] = useState(false);

  const emailGateOpen = Boolean(
    authenticated && user && user.emailVerified === false && user.isAdmin !== true
  );
  const mfaGateOpen = Boolean(
    authenticated && user?.isAdmin && user.mfaEnabled === false
  );
  const authProductGateOpen = emailGateOpen || mfaGateOpen;

  const refresh = async () => {
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
  };

  useEffect(() => {
    if (!authenticated) {
      setNeedsWizard(false);
      setChecking(false);
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
  ]);

  return { checking, needsWizard, refresh };
}
