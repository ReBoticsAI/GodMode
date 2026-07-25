/**
 * Embedding profile registry (#69).
 */
import { describe, expect, it } from "vitest";
import {
  codeProfileUsesSeparateServer,
  embedProfileModelId,
  listEmbedProfileIds,
  resolveEmbedProfile,
} from "../profiles.js";

describe("embed profiles", () => {
  it("lists memory and code", () => {
    expect(listEmbedProfileIds()).toEqual(["memory", "code"]);
  });

  it("resolves memory and code with shared defaults", () => {
    const memory = resolveEmbedProfile("memory");
    const code = resolveEmbedProfile("code");
    expect(memory.id).toBe("memory");
    expect(code.id).toBe("code");
    expect(memory.port).toBe(code.port);
    expect(embedProfileModelId(memory).length).toBeGreaterThan(0);
  });

  it("reports shared server when overrides unset", () => {
    expect(codeProfileUsesSeparateServer()).toBe(false);
  });
});
