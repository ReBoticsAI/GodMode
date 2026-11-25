import { describe, expect, it } from "vitest";
import {
  GODMODE_AUTO_MODEL_ID,
  GODMODE_AUTO_SECRET_ID,
  GODMODE_AUTO_TRANSPORT,
  isGodModeAutoModelId,
  isGodModeAutoSecretId,
  isGodModeInferenceSupplySecretId,
  pickGodModeInferenceSupplyTarget,
} from "../godmode-inference-supply.js";

describe("godmode inference Auto supply ids", () => {
  it("recognizes Auto secret and model ids", () => {
    expect(isGodModeAutoSecretId(GODMODE_AUTO_SECRET_ID)).toBe(true);
    expect(isGodModeAutoSecretId(`${GODMODE_AUTO_SECRET_ID}__agent__x`)).toBe(
      true
    );
    expect(isGodModeAutoModelId(GODMODE_AUTO_MODEL_ID)).toBe(true);
    expect(isGodModeAutoModelId("auto")).toBe(true);
    expect(isGodModeInferenceSupplySecretId(GODMODE_AUTO_SECRET_ID)).toBe(true);
    expect(isGodModeInferenceSupplySecretId("openrouter-api-key")).toBe(true);
    expect(isGodModeInferenceSupplySecretId("groq-api-key")).toBe(true);
    expect(isGodModeInferenceSupplySecretId("google-ai-api-key")).toBe(true);
  });

  it("pickGodModeInferenceSupplyTarget returns Auto when supply env present", () => {
    const prev = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    try {
      const target = pickGodModeInferenceSupplyTarget();
      expect(target).not.toBeNull();
      expect(target!.modelId).toBe(GODMODE_AUTO_MODEL_ID);
      expect(target!.apiKeyRef).toBe(GODMODE_AUTO_SECRET_ID);
      expect(target!.transport).toBe(GODMODE_AUTO_TRANSPORT);
      expect(target!.provider).toBe("auto");
    } finally {
      if (prev === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = prev;
    }
  });
});
