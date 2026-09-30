import { describe, expect, it } from "vitest";
import {
  PROMPT_PREVIEW_ELLIPSIS,
  truncatePromptPreview,
} from "../prompt-preview";

describe("truncatePromptPreview", () => {
  it("returns short prompts unchanged", () => {
    const short = "hello world";
    expect(truncatePromptPreview(short)).toEqual({
      text: short,
      truncated: false,
    });
  });

  it("returns threshold-length prompts unchanged", () => {
    const exact = "a".repeat(4_000);
    expect(truncatePromptPreview(exact)).toEqual({
      text: exact,
      truncated: false,
    });
  });

  it("truncates with head, marker, and tail when over threshold", () => {
    const head = "H".repeat(2_000);
    const mid = "M".repeat(5_000);
    const tail = "T".repeat(1_000);
    const full = `${head}${mid}${tail}`;
    const result = truncatePromptPreview(full);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith(head)).toBe(true);
    expect(result.text.endsWith(tail)).toBe(true);
    expect(result.text).toContain(PROMPT_PREVIEW_ELLIPSIS);
    expect(result.text.length).toBeLessThan(full.length);
    expect(result.text).not.toContain("MMMM");
  });

  it("honors custom sizes", () => {
    const full = "abcdefghij";
    const result = truncatePromptPreview(full, {
      threshold: 5,
      head: 2,
      tail: 2,
    });
    expect(result).toEqual({
      text: `ab${PROMPT_PREVIEW_ELLIPSIS}ij`,
      truncated: true,
    });
  });
});
