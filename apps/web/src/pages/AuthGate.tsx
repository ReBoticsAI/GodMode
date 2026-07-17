import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  fetchBridgeHealth,
  fetchSaasCheckoutStatus,
  fetchSaasPaywall,
  loginPassword,
  startSaasCheckout,
  signupPassword,
} from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { APP_NAME, HOME_PATH } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

type Mode = "login" | "signup";
/** SaaS signup: pick plan → pay → create account (no invite codes). */
type SaasSignupStep = "plan" | "account";

const SAAS_SESSION_KEY = "godmode_saas_checkout_session";

function readStoredCheckoutSession(): string {
  try {
    return sessionStorage.getItem(SAAS_SESSION_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function storeCheckoutSession(sessionId: string): void {
  try {
    sessionStorage.setItem(SAAS_SESSION_KEY, sessionId);
  } catch {
    /* private mode */
  }
}

function clearStoredCheckoutSession(): void {
  try {
    sessionStorage.removeItem(SAAS_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export default function AuthGate() {
  const { refresh } = useTenant();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [saasStep, setSaasStep] = useState<SaasSignupStep>("plan");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [checkoutSessionId, setCheckoutSessionId] = useState(readStoredCheckoutSession);
  const [emailLocked, setEmailLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saas, setSaas] = useState(false);
  const [paywallReady, setPaywallReady] = useState(false);
  const [refundAck, setRefundAck] = useState(false);
  const [checkoutMode, setCheckoutMode] = useState<"payment" | "subscription">(
    "payment"
  );

  useEffect(() => {
    void fetchBridgeHealth()
      .then((h) => {
        const isSaas = Boolean(h.saas);
        setSaas(isSaas);
        if (!isSaas) return;
        if (readStoredCheckoutSession()) {
          setSaasStep("account");
          setMode("signup");
        }
        return fetchSaasPaywall().then((p) => {
          setPaywallReady(p.paymentsConfigured && p.priceConfigured);
          setCheckoutMode(p.checkoutMode);
        });
      })
      .catch(() => {
        /* health optional on first paint */
      });
  }, []);

  useEffect(() => {
    if (!saas) return;
    const checkout = searchParams.get("saas_checkout");
    const sessionId = searchParams.get("session_id");

    if (checkout === "cancel") {
      setMode("signup");
      setSaasStep("plan");
      setRefundAck(false);
      toast.message("Checkout canceled — pick a plan when you are ready");
      setSearchParams({}, { replace: true });
      return;
    }

    if (checkout !== "success" || !sessionId) return;

    setMode("signup");
    setBusy(true);
    void fetchSaasCheckoutStatus(sessionId)
      .then((status) => {
        if (status.status === "consumed") {
          clearStoredCheckoutSession();
          setCheckoutSessionId("");
          setSaasStep("plan");
          toast.error("This payment was already used. Sign in, or purchase again.");
          return;
        }
        storeCheckoutSession(sessionId);
        setCheckoutSessionId(sessionId);
        setSaasStep("account");
        if (status.email) {
          setEmail(status.email);
          setEmailLocked(true);
        }
        toast.success("Payment confirmed — create your account to finish");
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Could not confirm payment");
        setSaasStep("plan");
      })
      .finally(() => {
        setSearchParams({}, { replace: true });
        setBusy(false);
      });
  }, [saas, searchParams, setSearchParams]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Email and password are required");
      return;
    }
    if (mode === "signup" && saas && !checkoutSessionId.trim()) {
      toast.error("Choose a plan and complete payment first");
      setSaasStep("plan");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await loginPassword(email.trim(), password);
        await refresh();
        navigate(HOME_PATH, { replace: true });
        toast.success("Signed in");
      } else {
        await signupPassword(email.trim(), password, name.trim(), {
          inviteCode: !saas && inviteCode.trim() ? inviteCode.trim() : undefined,
          checkoutSessionId: saas ? checkoutSessionId.trim() : undefined,
        });
        clearStoredCheckoutSession();
        await refresh();
        navigate(HOME_PATH, { replace: true });
        toast.success("Account created");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const continueToPayment = async () => {
    setBusy(true);
    try {
      const origin = window.location.origin;
      const { url } = await startSaasCheckout({
        email: email.trim() || undefined,
        successUrl: `${origin}/?saas_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/?saas_checkout=cancel`,
      });
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    if (next === "signup" && saas && !checkoutSessionId) {
      setSaasStep("plan");
    } else if (next === "signup" && saas && checkoutSessionId) {
      setSaasStep("account");
    }
  };

  const showSaasPlan = saas && mode === "signup" && saasStep === "plan";
  const showAccountForm = !saas || mode === "login" || saasStep === "account";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <Card className={`w-full ${showSaasPlan ? "max-w-md" : "max-w-sm"}`}>
        <CardHeader className="text-center">
          <div className="mb-1 text-3xl font-bold tracking-tight">{APP_NAME}</div>
          <CardTitle>
            {mode === "login"
              ? "Sign in"
              : showSaasPlan
                ? "Choose a plan"
                : "Create account"}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? saas
                ? "Sign in to your GodMode cloud workspace."
                : "Sign in to your local GodMode workspace."
              : showSaasPlan
                ? "Pick a plan to unlock signup. You create your account after payment."
                : saas
                  ? "Payment confirmed. Create your account to open your workspace."
                  : "Create your account. The first signup becomes platform admin."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {showSaasPlan && (
            <div className="flex flex-col gap-3">
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="text-sm font-medium">GodMode Cloud</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Hosted convenience — we run the infrastructure. Prefer to
                  self-host? The open-source local install is free.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {checkoutMode === "subscription"
                    ? "Billed as a subscription via Stripe Checkout."
                    : "Billed as a one-time payment via Stripe Checkout."}
                </p>
              </div>

              <div className="rounded-md border border-border p-3 text-left">
                <p className="text-sm font-medium">Refund policy</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  All sales are final. No refunds for change of mind, unused
                  access, or dissatisfaction with the cloud service. Try the free
                  open-source install first if you want to evaluate GodMode
                  without paying.
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  We will refund payment failures, duplicate charges, and cases
                  where an account was never provisioned after a successful
                  payment.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auth-email-plan">Email (optional)</Label>
                <Input
                  id="auth-email-plan"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>

              <label className="flex items-start gap-2 text-xs leading-snug text-muted-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 shrink-0 rounded border-border"
                  checked={refundAck}
                  onChange={(e) => setRefundAck(e.target.checked)}
                />
                <span>
                  I understand GodMode Cloud purchases are non-refundable except
                  for payment failures, duplicates, or failed provisioning, and
                  that a free self-hosted option exists.
                </span>
              </label>

              <Button
                type="button"
                disabled={busy || !paywallReady || !refundAck}
                className="w-full"
                onClick={() => void continueToPayment()}
              >
                {paywallReady ? "Continue to payment" : "Billing not configured"}
              </Button>
            </div>
          )}

          {showAccountForm && (
            <form onSubmit={submit} className="flex flex-col gap-3">
              {mode === "signup" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="auth-name">Name</Label>
                  <Input
                    id="auth-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </div>
              )}
              {!saas && mode === "signup" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="auth-invite">Invite code</Label>
                  <Input
                    id="auth-invite"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="If your hub requires one"
                    autoComplete="off"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  readOnly={emailLocked}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auth-password">Password</Label>
                <Input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
              </div>
              <Button type="submit" disabled={busy} className="mt-1 w-full">
                {mode === "login" ? "Sign in" : "Sign up"}
              </Button>
            </form>
          )}

          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            <Button
              type="button"
              variant="link"
              className="px-1"
              onClick={() => switchMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </Button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
