import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  fetchBridgeHealth,
  fetchOauthProviders,
  fetchSaasCheckoutStatus,
  fetchSaasPaywall,
  forgotPassword,
  loginPassword,
  requestEmailVerification,
  resetPassword,
  startOauth,
  startSaasCheckout,
  signupPassword,
  verifyEmailToken,
  verifyMfaLogin,
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
import { MfaEnrollForm } from "@/components/auth/MfaEnrollForm";

type Mode =
  | "login"
  | "signup"
  | "forgot"
  | "reset"
  | "mfa"
  | "verify-banner"
  | "mfa-setup";
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
  const { refresh, user } = useTenant();
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
    "subscription"
  );
  const [plans, setPlans] = useState<
    Array<{
      id: string;
      priceId: string;
      label: string;
      amountLabel: string;
      interval: "month" | "year" | "one_time";
    }>
  >([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [oauth, setOauth] = useState({ google: false, github: false });

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
          setPlans(p.plans ?? []);
          setSelectedPlanId((prev) => prev || p.plans?.[0]?.id || "");
        });
      })
      .catch(() => {
        /* health optional on first paint */
      });
    void fetchOauthProviders()
      .then(setOauth)
      .catch(() => setOauth({ google: false, github: false }));
  }, []);

  useEffect(() => {
    const verify = searchParams.get("verify");
    const reset = searchParams.get("reset");
    const mfa = searchParams.get("mfaToken");
    if (verify) {
      setBusy(true);
      void verifyEmailToken(verify)
        .then(async () => {
          toast.success("Email verified — you can sign in");
          await refresh();
          setMode("login");
        })
        .catch((err) =>
          toast.error(err instanceof Error ? err.message : "Verification failed")
        )
        .finally(() => {
          setSearchParams({}, { replace: true });
          setBusy(false);
        });
      return;
    }
    if (reset) {
      setResetToken(reset);
      setMode("reset");
      setSearchParams({}, { replace: true });
      return;
    }
    if (mfa) {
      setMfaToken(mfa);
      setMode("mfa");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, refresh]);

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

  useEffect(() => {
    if (!user) return;
    if (user.emailVerified === false) {
      setMode("verify-banner");
      setEmail(user.email);
      return;
    }
    if (saas && user.isAdmin && user.mfaEnabled === false) {
      setMode("mfa-setup");
    }
  }, [user, saas]);

  const finishLogin = async () => {
    await refresh();
    navigate(HOME_PATH, { replace: true });
    toast.success("Signed in");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "forgot") {
      setBusy(true);
      try {
        await forgotPassword(email.trim());
        toast.success("If that email exists, a reset link was sent");
        setMode("login");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Request failed");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === "reset") {
      if (password.length < 6) {
        toast.error("Password must be at least 6 characters");
        return;
      }
      setBusy(true);
      try {
        await resetPassword(resetToken, password);
        toast.success("Password updated — sign in");
        setMode("login");
        setPassword("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Reset failed");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === "mfa") {
      if (!mfaCode.trim()) {
        toast.error("Enter your authenticator code");
        return;
      }
      setBusy(true);
      try {
        await verifyMfaLogin(mfaToken, mfaCode.trim());
        await finishLogin();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "MFA failed");
      } finally {
        setBusy(false);
      }
      return;
    }
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
        const res = await loginPassword(email.trim(), password);
        if (res.mfaRequired && res.mfaToken) {
          setMfaToken(res.mfaToken);
          setMode("mfa");
          toast.message("Enter your authenticator code");
          return;
        }
        if (res.mfaSetupRequired) {
          await refresh();
          setMode("mfa-setup");
          toast.message("Enroll MFA to continue as a Cloud platform admin");
          return;
        }
        await finishLogin();
      } else if (mode === "signup") {
        await signupPassword(email.trim(), password, name.trim(), {
          inviteCode: !saas && inviteCode.trim() ? inviteCode.trim() : undefined,
          checkoutSessionId: saas ? checkoutSessionId.trim() : undefined,
        });
        clearStoredCheckoutSession();
        await refresh();
        toast.success("Account created — check your email to verify");
        setMode("verify-banner");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const continueToPayment = async () => {
    if (!selectedPlanId) {
      toast.error("Select a plan");
      return;
    }
    setBusy(true);
    try {
      const origin = window.location.origin;
      const { url } = await startSaasCheckout({
        email: email.trim() || undefined,
        plan: selectedPlanId,
        successUrl: `${origin}/?saas_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/?saas_checkout=cancel`,
      });
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    const target = email.trim() || user?.email || "";
    if (!target) {
      toast.error("Enter your email");
      return;
    }
    setBusy(true);
    try {
      await requestEmailVerification(target);
      toast.success("If that email exists, a verification link was sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send email");
    } finally {
      setBusy(false);
    }
  };

  const beginOauth = async (provider: "google" | "github") => {
    setBusy(true);
    try {
      const { url } = await startOauth(provider);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "OAuth unavailable");
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
  const showAccountForm =
    mode === "forgot" ||
    mode === "reset" ||
    mode === "mfa" ||
    mode === "verify-banner" ||
    mode === "mfa-setup" ||
    (!saas || mode === "login" || saasStep === "account");

  const title =
    mode === "forgot"
      ? "Forgot password"
      : mode === "reset"
        ? "Reset password"
        : mode === "mfa"
          ? "Two-factor authentication"
          : mode === "verify-banner"
            ? "Verify your email"
            : mode === "mfa-setup"
              ? "Enroll MFA"
              : mode === "login"
              ? "Sign in"
              : showSaasPlan
                ? "Choose a plan"
                : "Create account";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <Card className={`w-full ${showSaasPlan ? "max-w-md" : "max-w-sm"}`}>
        <CardHeader className="text-center">
          <div className="mb-1 text-3xl font-bold tracking-tight">{APP_NAME}</div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {mode === "forgot"
              ? "We will email a reset link if an account exists."
              : mode === "reset"
                ? "Choose a new password for your account."
                : mode === "mfa"
                  ? "Enter the 6-digit code from your authenticator app."
                  : mode === "verify-banner"
                    ? "Confirm your email to unlock the full product."
                    : mode === "mfa-setup"
                      ? "Platform admins must enroll authenticator MFA before using GodMode Cloud."
                      : mode === "login"
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
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Select a plan</p>
                {plans.map((plan) => {
                  const selected = selectedPlanId === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`rounded-md border p-3 text-left transition-colors ${
                        selected
                          ? "border-foreground bg-muted/60"
                          : "border-border bg-background hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{plan.label}</span>
                        <span className="text-sm">{plan.amountLabel}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {plan.interval === "year"
                          ? "Billed yearly via Stripe — about 2 months free vs monthly."
                          : plan.interval === "month"
                            ? "Billed monthly via Stripe. Cancel anytime in Stripe later."
                            : checkoutMode === "subscription"
                              ? "Subscription billed via Stripe Checkout."
                              : "One-time payment via Stripe Checkout."}
                      </p>
                    </button>
                  );
                })}
                {plans.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No plans configured yet.
                  </p>
                )}
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
                disabled={busy || !paywallReady || !refundAck || !selectedPlanId}
                className="w-full"
                onClick={() => void continueToPayment()}
              >
                {paywallReady ? "Continue to payment" : "Billing not configured"}
              </Button>
            </div>
          )}

          {showAccountForm && !showSaasPlan && (
            <form onSubmit={submit} className="flex flex-col gap-3">
              {mode === "verify-banner" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    We sent a verification link to <strong>{email || user?.email}</strong>.
                    Open it to continue.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void resendVerification()}
                  >
                    Resend verification email
                  </Button>
                  <Button type="button" variant="link" onClick={() => setMode("login")}>
                    Back to sign in
                  </Button>
                </>
              )}

              {mode === "mfa-setup" && (
                <MfaEnrollForm
                  onEnrolled={async () => {
                    await refresh();
                    navigate(HOME_PATH, { replace: true });
                    toast.success("Signed in");
                  }}
                />
              )}

              {mode === "mfa" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="auth-mfa">Authenticator code</Label>
                    <Input
                      id="auth-mfa"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                    />
                  </div>
                  <Button type="submit" disabled={busy} className="w-full">
                    Verify
                  </Button>
                </>
              )}

              {(mode === "forgot" || mode === "login" || mode === "signup") && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="auth-email">Email</Label>
                  <Input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    readOnly={emailLocked && mode === "signup"}
                  />
                </div>
              )}

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

              {(mode === "login" || mode === "signup" || mode === "reset") && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="auth-password">
                    {mode === "reset" ? "New password" : "Password"}
                  </Label>
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
              )}

              {mode !== "verify-banner" && mode !== "mfa" && mode !== "mfa-setup" && (
                <Button type="submit" disabled={busy} className="mt-1 w-full">
                  {mode === "forgot"
                    ? "Send reset link"
                    : mode === "reset"
                      ? "Update password"
                      : mode === "login"
                        ? "Sign in"
                        : "Sign up"}
                </Button>
              )}

              {mode === "login" && (
                <Button
                  type="button"
                  variant="link"
                  className="px-0 self-start"
                  onClick={() => setMode("forgot")}
                >
                  Forgot password?
                </Button>
              )}
            </form>
          )}

          {(mode === "login" || mode === "signup") && !showSaasPlan && (oauth.google || oauth.github) && (
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs text-muted-foreground">Or continue with</p>
              {oauth.google ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void beginOauth("google")}
                >
                  Google
                </Button>
              ) : null}
              {oauth.github ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void beginOauth("github")}
                >
                  GitHub
                </Button>
              ) : null}
            </div>
          )}

          {(mode === "login" || mode === "signup") && (
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
          )}

          {(mode === "forgot" || mode === "reset") && (
            <Button type="button" variant="link" onClick={() => setMode("login")}>
              Back to sign in
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
