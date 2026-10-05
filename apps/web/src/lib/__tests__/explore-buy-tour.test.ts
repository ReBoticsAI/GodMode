import { describe, expect, it } from "vitest";
import { isInferenceAllowanceExhaustedError } from "../explore-buy-tour";

describe("inference allowance exhausted detect", () => {
  it("detects allowance exhausted stream errors", () => {
    expect(
      isInferenceAllowanceExhaustedError(
        "GodMode Inference allowance exhausted. Buy Inference in Vault."
      )
    ).toBe(true);
    expect(
      isInferenceAllowanceExhaustedError(null, "INFERENCE_ALLOWANCE_EXHAUSTED")
    ).toBe(true);
    expect(isInferenceAllowanceExhaustedError("CURSOR_SESSION_STALE")).toBe(
      false
    );
  });
});
