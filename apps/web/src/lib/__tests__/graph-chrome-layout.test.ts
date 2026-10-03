import { describe, expect, it } from "vitest";

import {
  GRAPH_CHAT_WINDOW_Z,
  GRAPH_INFO_FOCUS_Z,
  GRAPH_MODAL_Z,
  GRAPH_PRIMARY_CHROME_Z,
  GRAPH_WINDOW_Z,
} from "../graph-chrome-layout";

function zRank(token: string): number {
  const match = /^z-\[(\d+)\]$/.exec(token);
  if (!match) throw new Error(`expected Tailwind arbitrary z token, got ${token}`);
  return Number(match[1]);
}

describe("graph chrome z-stack", () => {
  it("keeps floaters below modal portals below primary chrome", () => {
    expect(zRank(GRAPH_WINDOW_Z)).toBeLessThan(zRank(GRAPH_INFO_FOCUS_Z));
    expect(zRank(GRAPH_INFO_FOCUS_Z)).toBeLessThan(zRank(GRAPH_CHAT_WINDOW_Z));
    expect(zRank(GRAPH_CHAT_WINDOW_Z)).toBeLessThan(zRank(GRAPH_MODAL_Z));
    expect(zRank(GRAPH_MODAL_Z)).toBeLessThan(zRank(GRAPH_PRIMARY_CHROME_Z));
  });
});
