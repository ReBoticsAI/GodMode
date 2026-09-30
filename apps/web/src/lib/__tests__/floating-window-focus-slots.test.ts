import { describe, expect, it } from "vitest";
import {
  mergeFocusSlotOrder,
  swapFocusSlotIds,
} from "../floating-window-registry";

describe("focus tile slot order", () => {
  it("keeps chat in the large slot until a window is dropped onto its title", () => {
    const order = mergeFocusSlotOrder(null, ["chat", "information:market", "information:code"]);
    expect(order[0]).toBe("chat");
  });

  it("puts the dropped window in the large slot and chat in that window's tile", () => {
    const order = mergeFocusSlotOrder(null, ["chat", "information:market", "information:code"]);
    const swapped = swapFocusSlotIds(order, "chat", "information:code");
    expect(swapped).toEqual(["information:code", "information:market", "chat"]);
  });

  it("keeps a swap when a new window opens and drops one that closed", () => {
    const swapped = swapFocusSlotIds(
      ["chat", "information:market"],
      "chat",
      "information:market"
    );
    const next = mergeFocusSlotOrder(swapped, [
      "chat",
      "information:code",
    ]);
    expect(next).toEqual(["chat", "information:code"]);
  });
});
