import {
  createGodModeInferenceCheckout,
  startSaasCheckout,
} from "@/api";

export function inferenceCheckoutReturnUrls(
  origin: string,
  flag: "inference" | "cloud"
): { successUrl: string; cancelUrl: string } {
  const base = origin.replace(/\/$/, "");
  return {
    successUrl: `${base}/?${flag}=paid&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/?${flag}=cancel`,
  };
}

/** Placeholder visitor mail must not be sent to Stripe. */
export function canBillEmail(email: string, temporary?: boolean): boolean {
  const value = email.trim().toLowerCase();
  if (temporary) return false;
  if (value.startsWith("visitor+")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function startInferenceCheckout(planId: string): Promise<void> {
  const urls = inferenceCheckoutReturnUrls(window.location.origin, "inference");
  const session = await createGodModeInferenceCheckout(planId, urls);
  if (!session.url) throw new Error("Checkout did not return a URL");
  window.location.assign(session.url);
}

export async function startCloudSeatCheckout(
  email: string,
  planId: string
): Promise<void> {
  const urls = inferenceCheckoutReturnUrls(window.location.origin, "cloud");
  const session = await startSaasCheckout({
    email: email.trim(),
    plan: planId,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
  });
  if (!session.url) throw new Error("Checkout did not return a URL");
  window.location.assign(session.url);
}
