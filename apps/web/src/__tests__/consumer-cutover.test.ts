// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptFederatedShareInvite,
  applyCursorToIntelligence,
  cloneAiAgent,
  connectCursorApiKey,
  createAiMemory,
  createHook,
  deleteProjectCard,
  disconnectCursorApiKey,
  saveStructureGraphLayout,
  selectIntelligenceModel,
  uninstallWorkspacePlugin,
  updateAiWorkflow,
} from "../api";

describe("durable web mutation cutover", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses typed record CRUD and restores domain DTOs", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "memory-1",
            objectType: "Memory",
            data: { text: "Remember this", scope: "global", enabled: true },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "workflow-1",
            objectType: "Workflow",
            data: { name: "Review", enabled: true },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const memory = await createAiMemory({ text: "Remember this" });
    const workflow = await updateAiWorkflow("workflow-1", { enabled: true });

    expect(memory).toMatchObject({ id: "memory-1", text: "Remember this" });
    expect(workflow).toMatchObject({ id: "workflow-1", name: "Review" });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/records/Memory",
      "/api/records/Workflow/workflow-1",
    ]);
  });

  it("uses declared kernel actions without legacy route literals", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: "agent-copy",
              objectType: "Agent",
              data: { name: "Copy", backend: "local" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "agent-copy",
            name: "Copy",
            backend: "local",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const agent = await cloneAiAgent("agent-1", "Copy");

    expect(agent).toMatchObject({ id: "agent-copy", name: "Copy" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/records/Agent/agent-1/actions/clone"
    );
  });

  it("maps hook DTO fields to kernel storage names", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "hook-1",
          objectType: "Hook",
          data: { name: "Daily", trigger_kind: "schedule" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await createHook({
      name: "Daily",
      triggerKind: "schedule",
      scheduleCron: "0 9 * * *",
      actionKind: "notify",
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchMock.mock.calls[0][0]).toBe("/api/records/Hook");
    expect(JSON.parse(String(request.body))).toMatchObject({
      data: {
        trigger_kind: "schedule",
        schedule_cron: "0 9 * * *",
        action_kind: "notify",
      },
    });
  });

  it("uses kernel contracts for the formerly unmapped core operations", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { ok: true, pluginId: "demo" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              ok: true,
              active: { id: "local:C:/models/demo.gguf", source: "local" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    await deleteProjectCard("card-1");
    await saveStructureGraphLayout({
      version: 1,
      positions: {},
      collapsed: [],
    });
    await uninstallWorkspacePlugin("demo");
    await selectIntelligenceModel({
      source: "local",
      path: "C:/models/demo.gguf",
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/records/TaskCard/card-1",
      "/api/records/StructureNode/actions/save_layout",
      "/api/records/CatalogInstall/actions/uninstall_plugin",
      "/api/records/ModelRuntime/runtime/actions/select_model",
    ]);
  });

  it("routes Cursor credentials and federation acceptance through kernel contracts", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "cursor-api-key",
            objectType: "ProviderCredential",
            data: { provider: "cursor", masked_token: "abcd…wxyz" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ connected: true, source: "vault", masked: "abcd…wxyz" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ connected: false, source: "none" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { grantId: "grant-1" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    expect((await connectCursorApiKey("cursor-secret")).status.connected).toBe(true);
    expect((await disconnectCursorApiKey()).status.connected).toBe(false);
    await applyCursorToIntelligence("composer-2.5");
    await acceptFederatedShareInvite("invite-secret", "https://owner.example");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/records/ProviderCredential",
      "/api/ai/cursor/status",
      "/api/records/ProviderCredential/cursor-api-key",
      "/api/ai/cursor/status",
      "/api/records/ModelRuntime/runtime/actions/select_model",
      "/api/records/FederatedShareInvite/actions/accept",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[4][1] as RequestInit).body))).toMatchObject({
      model_id: "cursor:composer-2.5",
    });
    expect(JSON.parse(String((fetchMock.mock.calls[5][1] as RequestInit).body))).toMatchObject({
      invite_token: "invite-secret",
    });
  });
});
