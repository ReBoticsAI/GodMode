import { describe, expect, it } from "vitest";
import { resolveBrowserStageAllowed } from "../browser/browser-access.js";
import { hostAllowed } from "../browser/browser-session.js";

describe("resolveBrowserStageAllowed", () => {
  it("defaults on when not SaaS", () => {
    expect(resolveBrowserStageAllowed({ isSaas: false })).toBe(true);
  });

  it("defaults off on SaaS", () => {
    expect(resolveBrowserStageAllowed({ isSaas: true })).toBe(false);
  });

  it("honors env force on/off", () => {
    expect(
      resolveBrowserStageAllowed({ isSaas: true, envAllow: "1" })
    ).toBe(true);
    expect(
      resolveBrowserStageAllowed({ isSaas: false, envAllow: "0" })
    ).toBe(false);
  });
});

describe("hostAllowed", () => {
  it("allows any host when allowlist empty", () => {
    expect(hostAllowed("https://example.com/x", [])).toBe(true);
  });

  it("matches host and subdomains", () => {
    expect(hostAllowed("https://a.example.com/", ["example.com"])).toBe(true);
    expect(hostAllowed("https://example.com/", ["example.com"])).toBe(true);
    expect(hostAllowed("https://evil.com/", ["example.com"])).toBe(false);
  });
});
