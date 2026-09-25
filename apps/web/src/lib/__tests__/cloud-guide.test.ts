import { describe, expect, it } from "vitest";
import {
  CLOUD_GUIDE_STOPS,
  CLOUD_MONTHLY_PRICE,
  CLOUD_SIGNUP_URL,
  CLOUD_YEARLY_PRICE,
} from "../cloud-guide";

describe("cloud guide", () => {
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
});
