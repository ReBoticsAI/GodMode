import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_GUIDE_STOPS,
  CLOUD_MONTHLY_PRICE,
  CLOUD_SIGNUP_URL,
  CLOUD_YEARLY_PRICE,
  cloudSignupUrl,
  openCloudSignupFallback,
} from "../cloud-guide";

vi.mock("../graph-phone-shell", () => ({
  isPhoneViewport: vi.fn(() => false),
}));

import { isPhoneViewport } from "../graph-phone-shell";

describe("cloud guide", () => {
  beforeEach(() => {
    vi.mocked(isPhoneViewport).mockReturnValue(false);
  });

  it("walks the signup page with the published prices", () => {
    expect(CLOUD_GUIDE_STOPS.map((stop) => stop.id)).toEqual([
      "workspace",
      "monthly",
      "yearly",
      "keys",
      "signup",
    ]);
    const text = CLOUD_GUIDE_STOPS.map((stop) => stop.say).join(" ");
    expect(text).toContain(CLOUD_MONTHLY_PRICE);
    expect(text).toContain(CLOUD_YEARLY_PRICE);
    expect(text).toContain("Cloud with Inference");
    expect(text).not.toContain("\u2014");
    expect(CLOUD_SIGNUP_URL).toContain("godmode.software");
  });

  it("builds signup URLs with AuthGate query, plan, and email", () => {
    const href = cloudSignupUrl("monthly_inference", "a@b.co");
    expect(href).toContain("auth=1");
    expect(href).toContain("signup=1");
    expect(href).toContain("plan=monthly_inference");
    expect(href).toContain("email=a%40b.co");
  });

  it("opens Cloud signup in the same tab on phone", () => {
    vi.mocked(isPhoneViewport).mockReturnValue(true);
    const assign = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("window", {
      location: { assign },
      open,
    });
    openCloudSignupFallback("monthly", "a@b.co");
    expect(assign).toHaveBeenCalledWith(
      expect.stringContaining("plan=monthly")
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("opens Cloud signup in a new tab on desktop", () => {
    vi.mocked(isPhoneViewport).mockReturnValue(false);
    const assign = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("window", {
      location: { assign },
      open,
    });
    openCloudSignupFallback("yearly", "a@b.co");
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("plan=yearly"),
      "_blank",
      "noreferrer"
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
