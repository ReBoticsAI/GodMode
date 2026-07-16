// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatesCard } from "@/components/admin/UpdatesCard";

const api = vi.hoisted(() => ({
  fetchRecords: vi.fn(),
  runRecordActionApi: vi.fn(),
  waitForOperationRun: vi.fn(),
}));

vi.mock("@/lib/object-types-api", () => api);
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("UpdatesCard", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "update-idempotency-key" });
    api.fetchRecords.mockResolvedValue({
      records: [
        {
          id: "installation-1",
          objectType: "InstallationUpdateState",
          data: {
            current_version: "0.1.0",
            target_version: "0.2.0",
            channel: "stable",
            status: "available",
            update_available: true,
            auto_check: true,
            can_apply: false,
            installation_surface: "docker",
          },
        },
      ],
      total: 1,
    });
    api.runRecordActionApi.mockResolvedValue({});
  });

  it("shows release state and dispatches checks through the kernel", async () => {
    render(<UpdatesCard />);

    expect(await screen.findByText("0.2.0 available")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("docker")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() =>
      expect(api.runRecordActionApi).toHaveBeenCalledWith(
        "InstallationUpdateState",
        "check_now",
        {},
        expect.objectContaining({
          id: "installation-1",
          idempotencyKey: "update-idempotency-key",
        })
      )
    );
  });

  it("does not render controls when the admin ObjectType is unavailable", async () => {
    api.fetchRecords.mockRejectedValue(new Error("forbidden"));
    const { container } = render(<UpdatesCard />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
