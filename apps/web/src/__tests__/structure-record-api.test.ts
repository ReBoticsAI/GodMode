// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStructureNode,
  deleteStructureNode,
  reorderStructureNodes,
  setNodeAgent,
  updateStructureNode,
} from "../api";

describe("Structure ObjectType client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("creates Structure pages through the generic Record API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "notes",
          data: {
            id: "notes",
            parent_id: null,
            label: "Notes",
            icon: "folder",
            segment: "notes",
            kind: "records",
            object_type: "WikiPage",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const node = await createStructureNode({
      id: "notes",
      label: "Notes",
      kind: "records",
      objectType: "WikiPage",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/records/StructureNode",
      expect.objectContaining({ method: "POST" })
    );
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toMatchObject({
      data: { id: "notes", object_type: "WikiPage" },
    });
    expect(node).toMatchObject({ id: "notes", objectType: "WikiPage" });
  });

  it("updates and deletes through the generic Record API", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "notes", data: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    await updateStructureNode("notes", { label: "Knowledge" });
    await deleteStructureNode("notes");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/records/StructureNode/notes",
      "/api/records/StructureNode/notes",
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      "PUT",
      "DELETE",
    ]);
  });

  it("sends flat action input for agent assignment and reorder", async () => {
    fetchMock.mockImplementation(() =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await setNodeAgent("notes", "agent-1");
    await reorderStructureNodes(null, ["notes", "tasks"]);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/records/StructureNode/notes/actions/set_agent",
      "/api/records/StructureNode/actions/reorder",
    ]);
    expect(
      fetchMock.mock.calls.map((call) =>
        JSON.parse(String((call[1] as RequestInit).body))
      )
    ).toEqual([
      { agent_id: "agent-1" },
      { parent_id: null, ordered_ids: ["notes", "tasks"] },
    ]);
  });
});
