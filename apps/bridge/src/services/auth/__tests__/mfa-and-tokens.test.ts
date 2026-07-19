import { describe, expect, it } from "vitest";
import {
  generateTotpSecret,
  hashAuthToken,
  totpCode,
  verifyTotp,
} from "../mfa-and-tokens.js";

describe("mfa-and-tokens", () => {
  it("hashes tokens stably", () => {
    expect(hashAuthToken("abc")).toBe(hashAuthToken("abc"));
    expect(hashAuthToken("abc")).not.toBe(hashAuthToken("abd"));
  });

  it("verifies TOTP for current window", () => {
    const { secretBase32 } = generateTotpSecret();
    const code = totpCode(secretBase32);
    expect(verifyTotp(secretBase32, code)).toBe(true);
    expect(verifyTotp(secretBase32, "000000")).toBe(false);
  });
});
