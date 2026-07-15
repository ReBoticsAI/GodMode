// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordListPage } from "../RecordListPage";

const api = vi.hoisted(() => ({
  fetchObjectType: vi.fn(),
  fetchRecords: vi.fn(),
}));

vi.mock("@/lib/object-types-api", () => api);
vi.mock("@/lib/structure-context", () => ({
  useStructure: () => ({ departments: [] }),
}));

describe("RecordListPage", () => {
  beforeEach(() => {
    api.fetchObjectType.mockResolvedValue({
      name: "Project",
      label: "Project",
      labelPlural: "Projects",
      storage: { kind: "adapter", adapterId: "projects" },
      fields: [
        { name: "title", label: "Title", fieldType: "Data" },
        { name: "meta", label: "Metadata", fieldType: "JSON" },
      ],
    });
    api.fetchRecords.mockResolvedValue({
      objectType: "Project",
      records: [{ id: "project-1", objectType: "Project", data: { title: "Kernel" } }],
      total: 1,
    });
  });

  it("renders metadata-defined columns and records", async () => {
    render(
      <MemoryRouter>
        <RecordListPage objectType="Project" />
      </MemoryRouter>
    );
    expect(await screen.findByText("Kernel")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.queryByText("Metadata")).not.toBeInTheDocument();
  });
});
