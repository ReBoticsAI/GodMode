import { describe, expect, it } from "vitest";
import { pathFromYou } from "../graph-path";

const EDGES = [
  { source: "hub:you", target: "hub:heart" },
  { source: "hub:heart", target: "hub:wiki" },
  { source: "hub:heart", target: "hub:workspace" },
  { source: "hub:you", target: "hub:vault-you" },
];

describe("pathFromYou", () => {
  it("walks from You through Hub to the target", () => {
    expect(pathFromYou(EDGES, "hub:wiki")).toEqual([
      "hub:you",
      "hub:heart",
      "hub:wiki",
    ]);
  });

  it("is just You when the stop is You", () => {
    expect(pathFromYou(EDGES, "hub:you")).toEqual(["hub:you"]);
  });

  it("still includes You when the node is not linked", () => {
    expect(pathFromYou(EDGES, "hub:missing")).toEqual(["hub:you", "hub:missing"]);
  });

  it("lights Intelligence through Hub when that edge points at Hub", () => {
    const edges = [
      ...EDGES,
      { source: "hub:intelligence", target: "hub:heart" },
    ];
    expect(pathFromYou(edges, "hub:intelligence")).toEqual([
      "hub:you",
      "hub:heart",
      "hub:intelligence",
    ]);
  });
});
