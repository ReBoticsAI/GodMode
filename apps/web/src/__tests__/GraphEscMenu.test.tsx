// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphEscMenu, type EscMenuCustomAction } from "@/components/graph/GraphEscMenu";

const mockNavigate = vi.fn();
const mockSetTheme = vi.fn();
let mockAuthenticated = false;
let mockUser: { email: string; displayName: string } | null = null;
let mockResolvedTheme = "dark";

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: mockResolvedTheme,
    setTheme: mockSetTheme,
  }),
}));

vi.mock("@/lib/tenant-context", () => ({
  useTenant: () => ({
    authenticated: mockAuthenticated,
    user: mockUser,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() },
}));

describe("GraphEscMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticated = false;
    mockUser = null;
    mockResolvedTheme = "dark";
  });

  afterEach(() => {
    cleanup();
  });

  it("opens when Escape key is pressed on the general surface", () => {
    render(<GraphEscMenu />);

    expect(screen.queryByText("System Menu")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByText("System Menu")).toBeInTheDocument();
    expect(screen.getByText("Return to Graph")).toBeInTheDocument();
  });

  it("closes when Escape key is pressed while the menu is open", async () => {
    render(<GraphEscMenu />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("System Menu")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("System Menu")).not.toBeInTheDocument();
    });
  });

  it("closes when Return to Graph button is clicked", async () => {
    render(<GraphEscMenu />);

    fireEvent.keyDown(window, { key: "Escape" });
    const resumeBtn = screen.getByRole("button", { name: /return to graph/i });

    fireEvent.click(resumeBtn);
    await waitFor(() => {
      expect(screen.queryByText("System Menu")).not.toBeInTheDocument();
    });
  });

  it("guards against accidental trigger when user is typing in an input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    try {
      render(<GraphEscMenu />);
      const blurSpy = vi.spyOn(input, "blur");

      fireEvent.keyDown(input, { key: "Escape" });

      expect(blurSpy).toHaveBeenCalled();
      expect(screen.queryByText("System Menu")).not.toBeInTheDocument();
    } finally {
      input.remove();
    }
  });

  it("guards against accidental trigger when user is typing in a textarea", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    try {
      render(<GraphEscMenu />);
      const blurSpy = vi.spyOn(textarea, "blur");

      fireEvent.keyDown(textarea, { key: "Escape" });

      expect(blurSpy).toHaveBeenCalled();
      expect(screen.queryByText("System Menu")).not.toBeInTheDocument();
    } finally {
      textarea.remove();
    }
  });

  it("guards against opening when another dialog or overlay is open", () => {
    const dialogContent = document.createElement("div");
    dialogContent.setAttribute("data-slot", "dialog-content");
    document.body.appendChild(dialogContent);

    try {
      render(<GraphEscMenu />);

      fireEvent.keyDown(window, { key: "Escape" });

      expect(screen.queryByText("System Menu")).not.toBeInTheDocument();
    } finally {
      dialogContent.remove();
    }
  });

  it("dispatches godmode:reset-graph-view when Reset Graph View is clicked", async () => {
    render(<GraphEscMenu />);

    fireEvent.keyDown(window, { key: "Escape" });

    const resetListener = vi.fn();
    window.addEventListener("godmode:reset-graph-view", resetListener);

    try {
      const resetBtn = screen.getByRole("button", { name: /reset graph view/i });
      fireEvent.click(resetBtn);

      expect(resetListener).toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByText("System Menu")).not.toBeInTheDocument();
      });
    } finally {
      window.removeEventListener("godmode:reset-graph-view", resetListener);
    }
  });

  it("toggles theme when Appearance button is clicked", () => {
    render(<GraphEscMenu />);

    fireEvent.keyDown(window, { key: "Escape" });

    const themeBtn = screen.getByRole("button", { name: /appearance/i });
    fireEvent.click(themeBtn);

    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("renders custom actions slot and handles clicks", async () => {
    const customSelect = vi.fn();
    const customActions: EscMenuCustomAction[] = [
      {
        id: "custom-tool",
        label: "Custom Workspace Action",
        description: "Special operator tool",
        badge: "Tool",
        onSelect: customSelect,
      },
    ];

    render(<GraphEscMenu customActions={customActions} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByText("Custom Workspace Action")).toBeInTheDocument();
    expect(screen.getByText("Special operator tool")).toBeInTheDocument();
    expect(screen.getByText("Tool")).toBeInTheDocument();

    const toolBtn = screen.getByRole("button", { name: /custom workspace action/i });
    fireEvent.click(toolBtn);

    expect(customSelect).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText("System Menu")).not.toBeInTheDocument();
    });
  });

  it("opens and closes via custom events", async () => {
    render(<GraphEscMenu />);

    expect(screen.queryByText("System Menu")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent("godmode:open-esc-menu"));
    });
    await waitFor(() => {
      expect(screen.getByText("System Menu")).toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("godmode:close-esc-menu"));
    });
    await waitFor(() => {
      expect(screen.queryByText("System Menu")).not.toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("godmode:toggle-esc-menu"));
    });
    await waitFor(() => {
      expect(screen.getByText("System Menu")).toBeInTheDocument();
    });
  });
});
