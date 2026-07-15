// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordFormPage } from "../RecordFormPage";

const api = vi.hoisted(() => ({
  fetchObjectType: vi.fn(),
  fetchRecord: vi.fn(),
  createRecordApi: vi.fn(),
  updateRecordApi: vi.fn(),
}));

vi.mock("@/lib/object-types-api", () => api);
vi.mock("@/lib/structure-context", () => ({
  useStructure: () => ({ departments: [] }),
}));

describe("RecordFormPage", () => {
  beforeEach(() => {
    api.fetchObjectType.mockResolvedValue({
      name: "Project",
      label: "Project",
      storage: { kind: "native" },
      fields: [
        { name: "title", label: "Title", fieldType: "Data", required: true },
        {
          name: "status",
          label: "Status",
          fieldType: "Select",
          options: ["open", "done"],
        },
        { name: "computed", label: "Computed", fieldType: "ReadOnly" },
      ],
    });
    api.createRecordApi.mockResolvedValue({ id: "project-1", data: {} });
  });

  it("builds and submits a form from ObjectType metadata", async () => {
    render(
      <MemoryRouter>
        <RecordFormPage objectType="Project" recordId="new" />
      </MemoryRouter>
    );
    fireEvent.change(await screen.findByLabelText("Title *"), {
      target: { value: "Kernel" },
    });
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "open" },
    });
    expect(screen.queryByLabelText("Computed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(api.createRecordApi).toHaveBeenCalledWith("Project", {
        title: "Kernel",
        status: "open",
      })
    );
  });
});
