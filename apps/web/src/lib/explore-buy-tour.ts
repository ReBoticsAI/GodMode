/** True when a chat stream error means GodMode Inference budget is spent. */
export function isInferenceAllowanceExhaustedError(
  error: string | null | undefined,
  code?: string | null
): boolean {
  const text = String(error ?? "").trim();
  if (!text && !code) return false;
  if (code === "INFERENCE_ALLOWANCE_EXHAUSTED") return true;
  return (
    /\ballowance exhausted\b/i.test(text) ||
    /\bused up\b.*\ballowance\b/i.test(text)
  );
}
