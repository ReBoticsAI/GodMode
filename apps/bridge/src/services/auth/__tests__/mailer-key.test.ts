import { describe, expect, it } from "vitest";
import { looksLikeResendApiKey } from "../mailer.js";

describe("looksLikeResendApiKey", () => {
  it("accepts a long re_ secret", () => {
    expect(looksLikeResendApiKey(`re_${"a".repeat(24)}`)).toBe(true);
  });

  it("rejects placeholders and short keys", () => {
    expect(looksLikeResendApiKey("")).toBe(false);
    expect(looksLikeResendApiKey("re_...")).toBe(false);
    expect(looksLikeResendApiKey("re_xxxxxxxxxx")).toBe(false);
    expect(looksLikeResendApiKey("sk_live_abc")).toBe(false);
  });
});
