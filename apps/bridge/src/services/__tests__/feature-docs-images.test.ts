import { describe, expect, it } from "vitest";
import { stripMarkdownImages } from "../feature-docs.js";

describe("stripMarkdownImages", () => {
  it("removes markdown and HTML images for wiki seed", () => {
    const input = `# Memory

![memory in GodMode](/features/memory.png)

Memory stores facts.

<img src="/features/memory.png" alt="x" />
`;
    const out = stripMarkdownImages(input);
    expect(out).not.toContain("![");
    expect(out).not.toContain("<img");
    expect(out).toContain("Memory stores facts.");
  });
});
