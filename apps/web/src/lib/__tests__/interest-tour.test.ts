import { describe, expect, it } from "vitest";
import { INTELLIGENCE_INTERESTS } from "../intelligence-interests";
import { interestTour } from "../interest-tour";

describe("interest tour", () => {
  it("scripts every interest with a fixed Graph walk", () => {
    for (const item of INTELLIGENCE_INTERESTS) {
      const stops = interestTour(item.id);
      expect(stops, item.id).not.toBeNull();
      expect(stops!.length).toBeGreaterThanOrEqual(4);
      expect(stops!.length).toBeLessThanOrEqual(6);
      expect(stops!.every((stop) => stop.nodeId.startsWith("hub:"))).toBe(true);
      expect(stops!.every((stop) => !stop.say.includes("\u2014"))).toBe(true);
      expect(stops!.map((stop) => stop.say).join(" ").toLowerCase()).not.toContain("sidebar");
    }
    expect(interestTour("missing")).toBeNull();
  });

  it("puts Seller on the Earn marketplace stop and keeps Create open", () => {
    const earn = interestTour("earn")!;
    const market = earn.find((stop) => stop.nodeId === "hub:marketplace");
    expect(market?.say).toContain("GodMode Seller");
    expect(market?.say).toContain("local");
    expect(market?.say).toContain("commerce only");
    const create = interestTour("create")!.map((stop) => stop.say).join(" ");
    expect(create).toContain("pages");
    expect(create).toContain("agents");
    expect(interestTour("battle")!.map((stop) => stop.say).join(" ")).toContain(
      "no live battle screen"
    );
  });
});
