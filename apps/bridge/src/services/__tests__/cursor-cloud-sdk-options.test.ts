/**
 * cursor_cloud SDK mode + model.params (#71 slice 4).
 */
import { describe, expect, it } from "vitest";
import {
  cursorCloudCacheFingerprint,
  toSdkAgentMode,
  toSdkModelParams,
} from "../agents/cursor-cloud-backend.js";

describe("toSdkModelParams", () => {
  it("serializes record values to sorted id/value pairs", () => {
    expect(
      toSdkModelParams({ fast: true, reasoning: "high", empty: null })
    ).toEqual([
      { id: "fast", value: "true" },
      { id: "reasoning", value: "high" },
    ]);
  });

  it("keeps string values unquoted", () => {
    expect(toSdkModelParams({ fast: "true" })).toEqual([
      { id: "fast", value: "true" },
    ]);
  });

  it("returns undefined for empty or missing params", () => {
    expect(toSdkModelParams(undefined)).toBeUndefined();
    expect(toSdkModelParams(null)).toBeUndefined();
    expect(toSdkModelParams({})).toBeUndefined();
  });
});

describe("toSdkAgentMode", () => {
  it("maps plan to SDK plan mode", () => {
    expect(toSdkAgentMode("plan")).toBe("plan");
  });

  it("maps agent and ask to SDK agent mode", () => {
    expect(toSdkAgentMode("agent")).toBe("agent");
    expect(toSdkAgentMode("ask")).toBe("agent");
    expect(toSdkAgentMode(undefined)).toBe("agent");
  });
});

describe("cursorCloudCacheFingerprint mode", () => {
  it("includes sdk mode so plan vs agent recreates the cached agent", () => {
    expect(
      cursorCloudCacheFingerprint("auto", "sys", "", "", "agent")
    ).not.toEqual(
      cursorCloudCacheFingerprint("auto", "sys", "", "", "plan")
    );
    expect(cursorCloudCacheFingerprint("auto", "sys")).toBe(
      "auto||sys||agent"
    );
  });
});
