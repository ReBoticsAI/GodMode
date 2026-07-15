import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getObjectType, registerObjectType } from "../registry.js";
import {
  executeTool,
  setKernelToolDispatcherForTests,
  type ToolExecContext,
} from "../../services/ai-tool-executor.js";
import {
  getToolSchemasForLlm,
  STATIC_GENERATED_COLLISION_NAMES,
} from "../../services/ai-tools-registry.js";

beforeAll(() => {
  if (!getObjectType("Notification")) {
    registerObjectType({
      name: "Notification",
      label: "Notification",
      storage: { kind: "native" },
      operations: ["create"],
      fields: [
        { name: "id", label: "Id", fieldType: "Data" },
        { name: "title", label: "Title", fieldType: "Data" },
      ],
    });
  }
});

afterEach(() => {
  setKernelToolDispatcherForTests();
});

function context(): ToolExecContext {
  return {
    db: {
      prepare() {
        throw new Error("AI tool attempted a direct database access");
      },
    } as ToolExecContext["db"],
    activeAgentId: "intelligence",
    userId: "user-1",
    chatId: "chat-1",
    confirmationApproved: true,
  };
}

describe("static AI tool kernel cutover", () => {
  it("exposes one generated definition for superseded static names", () => {
    const names = getToolSchemasForLlm().map((tool) => tool.function.name);
    expect(names.filter((name) => name === "create_notification")).toEqual([
      "create_notification",
    ]);
    expect(STATIC_GENERATED_COLLISION_NAMES.has("create_notification")).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("dispatches canonical generated mutation tools before legacy cases", async () => {
    const dispatch = vi.fn(() => ({
      id: "notification-1",
      objectType: "Notification",
      data: {},
    }));
    setKernelToolDispatcherForTests(dispatch);

    await executeTool(
      "create_notification",
      {
        recipient_kind: "user",
        recipient_id: "user-1",
        title: "Ready",
      },
      context()
    );

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]?.[1]).toBe("create_notification");
  });

  it.each([
    ["remember", { text: "Kernel-owned memory" }, "create_record", "Memory"],
    [
      "create_project_card",
      { title: "Kernel-owned task" },
      "create_record",
      "TaskCard",
    ],
    [
      "comment_card",
      { cardId: "card-1", body: "Kernel-owned comment" },
      "run_record_action",
      "TaskCard",
    ],
    [
      "create_user_calendar_event",
      { title: "Review", start_at: "2026-07-15T10:00:00Z" },
      "create_record",
      "CalendarEvent",
    ],
    [
      "create_listing",
      { kind: "skill", title: "Pack", priceCredits: 0 },
      "run_record_action",
      "MarketplaceListing",
    ],
  ])(
    "routes %s through generic kernel dispatch without DB access",
    async (toolName, args, kernelName, objectType) => {
      const dispatch = vi.fn(() => ({ id: "result-1", data: {} }));
      setKernelToolDispatcherForTests(dispatch);

      await executeTool(toolName, args, context());

      expect(dispatch).toHaveBeenCalled();
      expect(dispatch.mock.calls[0]?.[1]).toBe(kernelName);
      expect(dispatch.mock.calls[0]?.[2]).toMatchObject({ objectType });
    }
  );

  it("persists todo_write exclusively through CRUD and action dispatch", async () => {
    const dispatch = vi.fn(
      (_db, name: string, args: Record<string, unknown>) => {
        if (name === "get_record") return null;
        if (name === "list_records") return { records: [] };
        return {
          id: String((args.data as { id?: string } | undefined)?.id ?? "ok"),
        };
      }
    );
    setKernelToolDispatcherForTests(dispatch);

    const result = await executeTool(
      "todo_write",
      {
        todos: [
          { id: "one", content: "First", status: "in_progress" },
          { id: "two", content: "Second", status: "pending" },
        ],
      },
      context()
    );

    expect(result).toMatchObject({ ok: true, count: 2 });
    expect(dispatch.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([
        "get_record",
        "create_record",
        "run_record_action",
        "list_records",
      ])
    );
  });

  it("mirrors contributed memories through kernel dispatch on both databases", async () => {
    const dispatch = vi.fn((_db, _name, args: Record<string, unknown>) => ({
      id: String((args.data as { id?: string } | undefined)?.id ?? "memory"),
    }));
    setKernelToolDispatcherForTests(dispatch);
    const ctx = context();
    ctx.contributeDb = {
      prepare() {
        throw new Error("Contribute database was accessed directly");
      },
    } as ToolExecContext["db"];

    const result = await executeTool("remember", { text: "Shared fact" }, ctx);

    expect(result).toMatchObject({ contributed: true });
    expect(dispatch.mock.calls.map((call) => call[1])).toEqual([
      "create_record",
      "create_record",
    ]);
    expect(dispatch.mock.calls[0]?.[0]).toBe(ctx.db);
    expect(dispatch.mock.calls[1]?.[0]).toBe(ctx.contributeDb);
  });

  it("uses TaskCard actions for lane and lifecycle changes", async () => {
    const dispatch = vi.fn(() => ({ id: "card-1", data: {} }));
    setKernelToolDispatcherForTests(dispatch);

    await executeTool(
      "update_card",
      { cardId: "card-1", columnId: "review", status: "accepted" },
      context()
    );

    const actions = dispatch.mock.calls
      .filter((call) => call[1] === "run_record_action")
      .map((call) => call[2]);
    expect(actions).toEqual([
      expect.objectContaining({ action: "move" }),
      expect.objectContaining({ action: "transition" }),
    ]);
  });
});
