import { describe, expect, it } from "vitest";
import { detectDesktopOs } from "@/lib/desktop-os";

describe("detectDesktopOs", () => {
  it("names the desktop build", () => {
    expect(detectDesktopOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "windows"
    );
    expect(detectDesktopOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(
      "macos"
    );
    expect(detectDesktopOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });

  it("skips phones", () => {
    expect(detectDesktopOs("Mozilla/5.0 (Linux; Android 14)")).toBeNull();
    expect(detectDesktopOs("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(
      null
    );
  });
});
